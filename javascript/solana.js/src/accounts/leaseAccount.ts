import * as anchor from '@project-serum/anchor';
import * as errors from '../errors';
import * as types from '../generated';
import { SwitchboardProgram } from '../SwitchboardProgram';
import { Account } from './account';
import * as spl from '@solana/spl-token';
import {
  AccountInfo,
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionSignature,
} from '@solana/web3.js';
import { AggregatorAccount } from './aggregatorAccount';
import { QueueAccount } from './queueAccount';
import { TransactionObject } from '../TransactionObject';
import BN from 'bn.js';
import { JobAccount } from './jobAccount';
import { OracleJob } from '@switchboard-xyz/common';

/**
 * Account type representing an {@linkcode AggregatorAccount}'s pre-funded escrow used to reward {@linkcode OracleAccount}'s for responding to open round requests.
 *
 * Data: {@linkcode types.LeaseAccountData}
 */
export class LeaseAccount extends Account<types.LeaseAccountData> {
  static accountName = 'LeaseAccountData';

  public static size = 453;

  /**
   * Get the size of an {@linkcode LeaseAccount} on-chain.
   */
  public size = this.program.account.leaseAccountData.size;

  /**
   * Return a lease account state initialized to the default values.
   */
  public static default(): types.LeaseAccountData {
    const buffer = Buffer.alloc(LeaseAccount.size, 0);
    types.LeaseAccountData.discriminator.copy(buffer, 0);
    return types.LeaseAccountData.decode(buffer);
  }

  /**
   * Create a mock account info for a given lease config. Useful for test integrations.
   */
  public static createMock(
    programId: PublicKey,
    data: Partial<types.LeaseAccountData>,
    options?: {
      lamports?: number;
      rentEpoch?: number;
    }
  ): AccountInfo<Buffer> {
    const fields: types.LeaseAccountDataFields = {
      ...LeaseAccount.default(),
      ...data,
      // any cleanup actions here
    };
    const state = new types.LeaseAccountData(fields);

    const buffer = Buffer.alloc(LeaseAccount.size, 0);
    types.LeaseAccountData.discriminator.copy(buffer, 0);
    types.LeaseAccountData.layout.encode(state, buffer, 8);

    return {
      executable: false,
      owner: programId,
      lamports: options?.lamports ?? 1 * LAMPORTS_PER_SOL,
      data: buffer,
      rentEpoch: options?.rentEpoch ?? 0,
    };
  }

  /** Load an existing LeaseAccount with its current on-chain state */
  public static async load(
    program: SwitchboardProgram,
    queue: PublicKey | string,
    aggregator: PublicKey | string
  ): Promise<[LeaseAccount, types.LeaseAccountData, number]> {
    const [account, bump] = LeaseAccount.fromSeed(
      program,
      typeof queue === 'string' ? new PublicKey(queue) : queue,
      typeof aggregator === 'string' ? new PublicKey(aggregator) : aggregator
    );
    const state = await account.loadData();
    return [account, state, bump];
  }

  /**
   * Loads a LeaseAccount from the expected PDA seed format.
   * @param program The Switchboard program for the current connection.
   * @param queue The queue pubkey to be incorporated into the account seed.
   * @param aggregator The aggregator pubkey to be incorporated into the account seed.
   * @return LeaseAccount and PDA bump.
   */
  public static fromSeed(
    program: SwitchboardProgram,
    queue: PublicKey,
    aggregator: PublicKey
  ): [LeaseAccount, number] {
    const [publicKey, bump] = anchor.utils.publicKey.findProgramAddressSync(
      [Buffer.from('LeaseAccountData'), queue.toBytes(), aggregator.toBytes()],
      program.programId
    );
    return [new LeaseAccount(program, publicKey), bump];
  }

  /**
   * Retrieve and decode the {@linkcode types.LeaseAccountData} stored in this account.
   */
  public async loadData(): Promise<types.LeaseAccountData> {
    const data = await types.LeaseAccountData.fetch(
      this.program,
      this.publicKey
    );
    if (data === null)
      throw new errors.AccountNotFoundError('Lease', this.publicKey);
    return data;
  }

  static async createInstructions(
    program: SwitchboardProgram,
    payer: PublicKey,
    params: LeaseInitParams
  ): Promise<[LeaseAccount, TransactionObject]> {
    const txns: Array<TransactionObject> = [];
    const loadAmount = params.fundAmount ?? 0;
    const loadTokenAmountBN = program.mint.toTokenAmountBN(loadAmount);

    const owner = params.funderAuthority
      ? params.funderAuthority.publicKey
      : payer;

    let funderTokenWallet: PublicKey;
    if (params.disableWrap === true) {
      funderTokenWallet =
        params.funderTokenWallet ?? program.mint.getAssociatedAddress(owner);
    } else {
      let tokenTxn: TransactionObject | undefined;
      // now we need to wrap some funds
      if (params.funderTokenWallet) {
        funderTokenWallet = params.funderTokenWallet;
        tokenTxn = await program.mint.wrapInstructions(
          payer,
          {
            fundUpTo: params.fundAmount ?? 0,
          },
          params.funderAuthority
        );
      } else {
        [funderTokenWallet, tokenTxn] =
          await program.mint.getOrCreateWrappedUserInstructions(
            payer,
            { fundUpTo: params.fundAmount ?? 0 },
            params.funderAuthority
          );
      }

      if (tokenTxn) {
        txns.push(tokenTxn);
      }
    }

    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
      program,
      params.queueAccount.publicKey,
      params.aggregatorAccount.publicKey
    );

    const escrow = program.mint.getAssociatedAddress(leaseAccount.publicKey);

    // load jobPubkeys and authorities ONLY if undefined
    // we need to allow empty arrays for initial job creation or else loading aggregator will fail
    let jobPubkeys = params.jobPubkeys;
    let jobAuthorities = params.jobAuthorities;
    if (jobPubkeys === undefined || jobAuthorities === undefined) {
      const aggregator = await params.aggregatorAccount.loadData();
      jobPubkeys = aggregator.jobPubkeysData.slice(
        0,
        aggregator.jobPubkeysSize
      );
      const jobs = await params.aggregatorAccount.loadJobs(aggregator);
      jobAuthorities = jobs.map(j => j.state.authority);
    }

    const wallets = LeaseAccount.getWallets(
      jobAuthorities ?? [],
      program.mint.address
    );
    const walletBumps = new Uint8Array(wallets.map(w => w.bump));

    const remainingAccounts: Array<AccountMeta> = (jobPubkeys ?? [])
      .concat(wallets.map(w => w.publicKey))
      .map(pubkey => {
        return { isSigner: false, isWritable: true, pubkey };
      });

    const createTokenAccountIxn = spl.createAssociatedTokenAccountInstruction(
      payer,
      escrow,
      leaseAccount.publicKey,
      program.mint.address
    );
    const leaseInitIxn = types.leaseInit(
      program,
      {
        params: {
          loadAmount: loadTokenAmountBN,
          withdrawAuthority: params.withdrawAuthority ?? payer,
          leaseBump: leaseBump,
          stateBump: program.programState.bump,
          walletBumps: walletBumps,
        },
      },
      {
        lease: leaseAccount.publicKey,
        queue: params.queueAccount.publicKey,
        aggregator: params.aggregatorAccount.publicKey,
        payer: payer,
        systemProgram: SystemProgram.programId,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        funder: funderTokenWallet,
        owner: owner,
        escrow: escrow,
        programState: program.programState.publicKey,
        mint: program.mint.address,
      }
    );
    leaseInitIxn.keys.push(...remainingAccounts);

    txns.push(
      new TransactionObject(
        payer,
        [createTokenAccountIxn, leaseInitIxn],
        params.funderAuthority ? [params.funderAuthority] : []
      )
    );

    const packed = TransactionObject.pack(txns);
    if (packed.length > 1) {
      throw new Error(`Failed to pack transactions into a single transactions`);
    }

    return [leaseAccount, packed[0]];
  }

  public static async create(
    program: SwitchboardProgram,
    params: LeaseInitParams
  ): Promise<[LeaseAccount, TransactionSignature]> {
    const [leaseAccount, transaction] = await LeaseAccount.createInstructions(
      program,
      program.walletPubkey,
      params
    );

    const signature = await program.signAndSend(transaction);
    return [leaseAccount, signature];
  }

  public async fetchBalance(escrow?: PublicKey): Promise<number> {
    const escrowPubkey =
      escrow ?? this.program.mint.getAssociatedAddress(this.publicKey);
    const escrowBalance = await this.program.mint.fetchBalance(escrowPubkey);
    if (escrowBalance === null) {
      throw new errors.AccountNotFoundError('Lease Escrow', escrowPubkey);
    }
    return escrowBalance;
  }

  public async fetchBalanceBN(escrow?: PublicKey): Promise<BN> {
    const escrowPubkey =
      escrow ?? this.program.mint.getAssociatedAddress(this.publicKey);
    const escrowBalance = await this.program.mint.fetchBalanceBN(escrowPubkey);
    if (escrowBalance === null) {
      throw new errors.AccountNotFoundError('Lease Escrow', escrowPubkey);
    }
    return escrowBalance;
  }

  public async extendInstruction(
    payer: PublicKey,
    params: LeaseExtendParams
  ): Promise<TransactionObject> {
    const owner = params.funderAuthority
      ? params.funderAuthority.publicKey
      : payer;

    const funderTokenWallet =
      params.funderTokenWallet ?? this.program.mint.getAssociatedAddress(owner);

    const { lease, jobs, wallets } = await this.fetchAllAccounts();

    const leaseBump = LeaseAccount.fromSeed(
      this.program,
      lease.queue,
      lease.aggregator
    )[1];
    const walletBumps = new Uint8Array(wallets.map(w => w.bump));

    const leaseExtend = types.leaseExtend(
      this.program,
      {
        params: {
          loadAmount: this.program.mint.toTokenAmountBN(params.fundAmount),
          stateBump: this.program.programState.bump,
          leaseBump,
          walletBumps: new Uint8Array(walletBumps),
        },
      },
      {
        lease: this.publicKey,
        escrow: lease.escrow,
        aggregator: lease.aggregator,
        queue: lease.queue,
        funder: funderTokenWallet,
        owner: owner,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        programState: this.program.programState.publicKey,
        mint: this.program.mint.address,
      }
    );

    // add job and job authority associated token accounts to remaining accounts for lease payouts
    const jobPubkeys = jobs.map(j => j.account.publicKey);
    const walletPubkeys = wallets.map(w => w.publicKey);
    const remainingAccounts: Array<AccountMeta> = jobPubkeys
      .concat(walletPubkeys)
      .map((pubkey: PublicKey): AccountMeta => {
        return { isSigner: false, isWritable: true, pubkey };
      });
    leaseExtend.keys.push(...remainingAccounts);

    return new TransactionObject(
      payer,
      [leaseExtend],
      params.funderAuthority ? [params.funderAuthority] : []
    );
  }

  public async extend(
    params: LeaseExtendParams
  ): Promise<TransactionSignature> {
    const leaseExtend = await this.extendInstruction(
      this.program.walletPubkey,
      params
    );
    const txnSignature = await this.program.signAndSend(leaseExtend);
    return txnSignature;
  }

  public async withdrawInstruction(
    payer: PublicKey,
    params: {
      amount: number | 'all';
      unwrap?: boolean;
      withdrawWallet: PublicKey;
      withdrawAuthority?: Keypair;
    }
  ): Promise<TransactionObject> {
    const txns: Array<TransactionObject> = [];

    const withdrawAuthority = params.withdrawAuthority
      ? params.withdrawAuthority.publicKey
      : payer;
    const withdrawWallet = params.withdrawWallet;

    const { lease, queue, aggregatorAccount, aggregator, balance } =
      await this.fetchAccounts();

    // calculate expected final balance
    const leaseBalance = this.program.mint.toTokenAmountBN(balance);
    const minRequiredBalance = LeaseAccount.minimumLeaseAmount(
      aggregator.oracleRequestBatchSize,
      queue.reward
    );

    const maxWithdrawAmount = leaseBalance.sub(minRequiredBalance);

    const withdrawAmount: BN = (() => {
      if (params.amount === 'all') return maxWithdrawAmount;
      const requestedWithdrawAmount = this.program.mint.toTokenAmountBN(
        params.amount
      );
      return requestedWithdrawAmount.lte(maxWithdrawAmount)
        ? requestedWithdrawAmount
        : maxWithdrawAmount;
    })();

    const leaseBump = LeaseAccount.fromSeed(
      this.program,
      lease.queue,
      lease.aggregator
    )[1];

    txns.push(
      new TransactionObject(
        payer,
        [
          types.leaseWithdraw(
            this.program,
            {
              params: {
                stateBump: this.program.programState.bump,
                leaseBump: leaseBump,
                amount: withdrawAmount,
              },
            },
            {
              lease: this.publicKey,
              escrow: lease.escrow,
              aggregator: aggregatorAccount.publicKey,
              queue: lease.queue,
              withdrawAuthority: withdrawAuthority,
              withdrawAccount: withdrawWallet,
              tokenProgram: spl.TOKEN_PROGRAM_ID,
              programState: this.program.programState.publicKey,
              mint: this.program.mint.address,
            }
          ),
        ],
        params.withdrawAuthority ? [params.withdrawAuthority] : []
      )
    );

    if (params.unwrap) {
      const unwrapAmount = this.program.mint.fromTokenAmountBN(withdrawAmount);
      txns.push(
        await this.program.mint.unwrapInstructions(
          payer,
          unwrapAmount,
          params.withdrawAuthority
        )
      );
    }

    const packed = TransactionObject.pack(txns);
    if (packed.length > 1) {
      throw new Error(`TransactionOverflowError`);
    }

    return packed[0];
  }

  public async withdraw(params: {
    amount: number | 'all';
    unwrap?: boolean;
    withdrawWallet: PublicKey;
    withdrawAuthority?: Keypair;
  }): Promise<TransactionSignature> {
    const withdrawTxn = await this.withdrawInstruction(
      this.program.walletPubkey,
      params
    );
    const txnSignature = await this.program.signAndSend(withdrawTxn);
    return txnSignature;
  }

  public async setAuthority(params: {
    newAuthority: PublicKey;
    withdrawAuthority: Keypair;
  }): Promise<TransactionSignature> {
    const setAuthorityTxn = this.setAuthorityInstruction(
      this.program.walletPubkey,
      params
    );
    const txnSignature = await this.program.signAndSend(setAuthorityTxn);
    return txnSignature;
  }

  public setAuthorityInstruction(
    payer: PublicKey,
    params: {
      newAuthority: PublicKey;
      withdrawAuthority?: Keypair;
    }
  ): TransactionObject {
    return new TransactionObject(
      payer,
      [
        types.leaseSetAuthority(
          this.program,
          {
            params: {},
          },
          {
            lease: this.publicKey,
            withdrawAuthority: params.withdrawAuthority
              ? params.withdrawAuthority.publicKey
              : payer,
            newAuthority: params.newAuthority,
          }
        ),
      ],
      params.withdrawAuthority ? [params.withdrawAuthority] : []
    );
  }
  public static minimumLeaseAmount(
    oracleRequestBatchSize: number,
    queueReward: BN
  ): BN {
    return queueReward.mul(new BN(oracleRequestBatchSize + 1));
  }

  /**
   * Estimate the time remaining on a given lease
   * @param oracleRequestBatchSize - the number of oracles to request per openRound call, for a given aggregator.
   * @param minUpdateDelaySeconds - the number of seconds between openRound calls, for a given aggregator.
   * @param queueReward - the number of tokens deducted from an aggregator's lease for each successful openRound call. This is dependent on the queue an aggregator belongs to.
   * @param leaseBalance - the current balance in a lease in decimal format.
   * @returns a tuple containing the number of milliseconds left in a lease and the estimated end date
   */
  public static estimatedLeaseTimeRemaining(
    oracleRequestBatchSize: number,
    minUpdateDelaySeconds: number,
    queueReward: BN,
    leaseBalance: number
  ): [number, Date] {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000; // ms in a day
    const updatesPerDay = (60 * 60 * 24) / (minUpdateDelaySeconds * 1.5); // account for jitter
    const costPerDay =
      (oracleRequestBatchSize + 1) * // add 1 to reward crank turner
      queueReward.toNumber() *
      updatesPerDay;

    const endDate = new Date();
    endDate.setTime((now + leaseBalance * msPerDay) / costPerDay);

    return [endDate.getTime() - now, endDate];
  }

  /**
   * Estimate the time remaining on a given lease
   * @returns number milliseconds left in lease (estimate)
   */
  public async estimatedLeaseTimeRemaining(): Promise<number> {
    const { queue, aggregator, balance } = await this.fetchAccounts();

    const batchSize = aggregator.oracleRequestBatchSize + 1;
    const minUpdateDelaySeconds = aggregator.minUpdateDelaySeconds * 1.5; // account for jitters with * 1.5
    const updatesPerDay = (60 * 60 * 24) / minUpdateDelaySeconds;
    const costPerDay = batchSize * queue.reward.toNumber() * updatesPerDay;
    const msPerDay = 24 * 60 * 60 * 1000;
    const endDate = new Date();
    endDate.setTime(endDate.getTime() + (balance * msPerDay) / costPerDay);
    const timeLeft = endDate.getTime() - Date.now();
    return timeLeft;
  }

  static getWallets(
    jobAuthorities: Array<PublicKey>,
    mint: PublicKey
  ): Array<{ publicKey: PublicKey; bump: number }> {
    const wallets: Array<{ publicKey: PublicKey; bump: number }> = [];

    for (const jobAuthority of jobAuthorities) {
      if (!jobAuthority || PublicKey.default.equals(jobAuthority)) {
        continue;
      }
      const [jobWallet, bump] = anchor.utils.publicKey.findProgramAddressSync(
        [
          jobAuthority.toBuffer(),
          spl.TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );
      wallets.push({ publicKey: jobWallet, bump });
    }

    return wallets;
  }

  async fetchAccounts(_lease?: types.LeaseAccountData): Promise<{
    lease: types.LeaseAccountData;
    queueAccount: QueueAccount;
    queue: types.OracleQueueAccountData;
    aggregatorAccount: AggregatorAccount;
    aggregator: types.AggregatorAccountData;
    escrow: spl.Account;
    balance: number;
  }> {
    const lease = _lease ?? (await this.loadData());

    const aggregatorAccount = new AggregatorAccount(
      this.program,
      lease.aggregator
    );

    const queueAccount = new QueueAccount(this.program, lease.queue);

    const accountInfos = await this.program.connection.getMultipleAccountsInfo([
      lease.aggregator,
      lease.queue,
      lease.escrow,
    ]);

    // decode aggregator
    const aggregatorAccountInfo = accountInfos.shift();
    if (!aggregatorAccountInfo) {
      throw new errors.AccountNotFoundError('Aggregator', lease.aggregator);
    }
    const aggregator = types.AggregatorAccountData.decode(
      aggregatorAccountInfo.data
    );

    // decode queue
    const queueAccountInfo = accountInfos.shift();
    if (!queueAccountInfo) {
      throw new errors.AccountNotFoundError('Queue', lease.queue);
    }
    const queue = types.OracleQueueAccountData.decode(queueAccountInfo.data);

    const leaseAccountInfo = accountInfos.shift();
    if (!leaseAccountInfo) {
      throw new errors.AccountNotFoundError('LeaseEscrow', lease.escrow);
    }
    const escrow = spl.unpackAccount(lease.escrow, leaseAccountInfo);
    const balance = this.program.mint.fromTokenAmount(escrow.amount);

    return {
      lease,
      queueAccount,
      queue,
      aggregatorAccount,
      aggregator,
      escrow,
      balance,
    };
  }

  async fetchAllAccounts(_lease?: types.LeaseAccountData): Promise<{
    lease: types.LeaseAccountData;
    queueAccount: QueueAccount;
    queue: types.OracleQueueAccountData;
    aggregatorAccount: AggregatorAccount;
    aggregator: types.AggregatorAccountData;
    escrow: spl.Account;
    balance: number;
    jobs: Array<{
      account: JobAccount;
      state: types.JobAccountData;
      job: OracleJob;
    }>;
    wallets: Array<{ publicKey: PublicKey; bump: number }>;
  }> {
    const {
      lease,
      queueAccount,
      queue,
      aggregatorAccount,
      aggregator,
      escrow,
      balance,
    } = await this.fetchAccounts(_lease);

    // load aggregator jobs for lease bumps
    const jobs = await aggregatorAccount.loadJobs(aggregator);
    const jobAuthorities = jobs.map(j => j.state.authority);
    const wallets = LeaseAccount.getWallets(
      jobAuthorities ?? [],
      this.program.mint.address
    );

    return {
      lease,
      queueAccount,
      queue,
      aggregatorAccount,
      aggregator,
      escrow,
      balance,
      jobs,
      wallets,
    };
  }
}

export interface LeaseInitParams extends Partial<LeaseExtendParams> {
  withdrawAuthority?: PublicKey;

  // maybe?
  aggregatorAccount: AggregatorAccount;
  queueAccount: QueueAccount;
  jobAuthorities?: Array<PublicKey>;
  jobPubkeys?: Array<PublicKey>;
}

export interface LeaseExtendParams {
  /** The amount to fund the lease with. */
  fundAmount: number;
  /** Optional, the token account to fund the lease from. Defaults to payer's associated token account if not provided. */
  funderTokenWallet?: PublicKey;
  /** Optional, the funderTokenWallet authority if it differs from the provided payer. */
  funderAuthority?: Keypair;
  /** Optional, disable auto wrapping funds if funderTokenWallet is missing funds */
  disableWrap?: boolean;
}

export interface LeaseWithdrawParams {
  amount: number | 'all';
  unwrap?: boolean;
  withdrawWallet: PublicKey;
  withdrawAuthority?: Keypair;
}
