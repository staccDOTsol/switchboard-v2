use crate::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock;
pub use switchboard_v2::VrfAccountData;
pub use raindrops_matches::Root;
pub use raindrops_matches::TokenDelta;
pub use crate::raindrops_matches::CreateOrUpdateOracleArgs;


use raindrops_matches;
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OracleArgs {
    token_transfer_root: Option<Root>,
    token_transfers: Option<Vec<TokenDelta>>,
    seed: Pubkey,
    space: u64,
    finalized: bool,
}


#[derive(Accounts)]
pub struct UpdateResult<'info> {
    #[account(mut, 
        has_one = vrf @ VrfErrorCode::InvalidVrfAccount
    )]
    pub state: AccountLoader<'info, VrfClient>,
    #[account(
        constraint = 
            *vrf.to_account_info().owner == SWITCHBOARD_PROGRAM_ID @ VrfErrorCode::InvalidSwitchboardAccount
    )]
    pub vrf: AccountLoader<'info, VrfAccountData>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    #[account(
            address = raindrops_matches::id()
    )]
    /// CHECKED: check
    pub raindrops: UncheckedAccount<'info>,
    #[account(
            address = crate::id()
    )]
    pub payer: Signer<'info>,
    /// CHECKED: check
    pub this: UncheckedAccount<'info>,
    pub oracle: Account<'info, raindrops_matches::WinOracle>
}
impl UpdateResult<'_> {
    pub fn validate(&self, _ctx: &Context<Self>) -> Result<()> {
        // We should check VRF account passed is equal to the pubkey stored in our client state
        // But skipping so we can re-use this program instruction for CI testing
        Ok(())
    }

    pub fn actuate(ctx: &Context<Self>, args: CreateOrUpdateOracleArgs, win_args:CreateOrUpdateOracleArgs) -> Result<()> {
        let clock = clock::Clock::get().unwrap();

        emit!(VrfClientInvoked {
            vrf_client: ctx.accounts.state.key(),
            timestamp: clock.unix_timestamp,
        });

        let vrf = ctx.accounts.vrf.load()?;
        let result_buffer = vrf.get_result()?;
        if result_buffer == [0u8; 32] {
            msg!("vrf buffer empty");
            return Ok(());
        }

        let state = &mut ctx.accounts.state.load_mut()?;
        let max_result = state.max_result;
        if result_buffer == state.result_buffer {
            msg!("existing result_buffer");
            return Ok(());
        }

        msg!("Result buffer is {:?}", result_buffer);
        let value: &[u128] = bytemuck::cast_slice(&result_buffer[..]);
        msg!("u128 buffer {:?}", value);
        let result = value[0] % max_result as u128 + 1;
        msg!("Current VRF Value [1 - {}) = {}!", max_result, result);

        if state.result != result {
            state.result_buffer = result_buffer;
            state.result = result;
            state.last_timestamp = clock.unix_timestamp;

            emit!(VrfClientResultUpdated {
                vrf_client: ctx.accounts.state.key(),
                result: state.result,
                result_buffer: result_buffer,
                timestamp: clock.unix_timestamp,
            });
        }
        let cpi_accounts = raindrops_matches::cpi::accounts::CreateOrUpdateOracle {
            oracle: ctx.accounts.oracle.to_account_info(),
            payer: ctx.accounts.this.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };
        let cpi_program = ctx.accounts.raindrops.to_account_info();

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        if result == 0 {
          
            // winner winner chickum dinner
                raindrops_matches::cpi::create_or_update_oracle(cpi_ctx, win_args);
        }
        else {
            // sorry not sorry
              // winner winner chickum dinner
                raindrops_matches::cpi::create_or_update_oracle(cpi_ctx, args);
        }
            Ok(())
    }
}
