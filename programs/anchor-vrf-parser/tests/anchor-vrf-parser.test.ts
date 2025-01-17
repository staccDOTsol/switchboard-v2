import * as anchor from "@project-serum/anchor";
import { AnchorProvider } from "@project-serum/anchor";
import * as spl from "../spl-token-2";
import {
  SystemProgram,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
} from "@solana/web3.js";
import {
  promiseWithTimeout,
  sleep,
  SwitchboardTestContext,
} from "@switchboard-xyz/sbv2-utils";
import {
  AnchorWallet,
  Callback,
  PermissionAccount,
  ProgramStateAccount,
  SwitchboardPermission,
  VrfAccount,
} from "@switchboard-xyz/switchboard-v2";
import "mocha";
import { AnchorVrfParser } from "../target/types/anchor_vrf_parser";
import { VrfClient } from "../client/accounts";
import { PROGRAM_ID } from "../client/programId";
const IDL = {
  "version": "0.1.0",
  "name": "anchor_vrf_parser",
  "instructions": [
    {
      "name": "initState",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "vrf",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": "InitStateParams"
          }
        }
      ]
    },
    {
      "name": "updateResult",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vrf",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "raindrops",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "this",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "oracle",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "CreateOrUpdateOracleArgs"
          }
        },
        {
          "name": "win_args",
          "type": {
            "defined": "CreateOrUpdateOracleArgs"
          }
        }
      ]
    },
    {
      "name": "requestResult",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vrf",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "oracleQueue",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "CHECK"
          ]
        },
        {
          "name": "queueAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "dataBuffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "CHECK"
          ]
        },
        {
          "name": "permission",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "CHECK"
          ]
        },
        {
          "name": "escrow",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "programState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "switchboardProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "payerWallet",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payerAuthority",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "recentBlockhashes",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": "RequestResultParams"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "VrfClient",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "maxResult",
            "type": "u64"
          },
          {
            "name": "resultBuffer",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "result",
            "type": "u128"
          },
          {
            "name": "lastTimestamp",
            "type": "i64"
          },
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "vrf",
            "type": "publicKey"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "CreateOrUpdateOracleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenTransferRoot",
            "type": {
              "option": {
                "defined": "Root"
              }
            }
          },
          {
            "name": "tokenTransfers",
            "type": {
              "option": {
                "vec": {
                  "defined": "TokenDelta"
                }
              }
            }
          },
          {
            "name": "seed",
            "type": "publicKey"
          },
          {
            "name": "space",
            "type": "u64"
          },
          {
            "name": "finalized",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "DrainOracleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seed",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "CreateMatchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchState",
            "type": {
              "defined": "MatchState"
            }
          },
          {
            "name": "tokenEntryValidationRoot",
            "type": {
              "option": {
                "defined": "Root"
              }
            }
          },
          {
            "name": "tokenEntryValidation",
            "type": {
              "option": {
                "vec": {
                  "defined": "TokenValidation"
                }
              }
            }
          },
          {
            "name": "winOracle",
            "type": "publicKey"
          },
          {
            "name": "winOracleCooldown",
            "type": "u64"
          },
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "space",
            "type": "u64"
          },
          {
            "name": "leaveAllowed",
            "type": "bool"
          },
          {
            "name": "joinAllowedDuringStart",
            "type": "bool"
          },
          {
            "name": "minimumAllowedEntryTime",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "desiredNamespaceArraySize",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "UpdateMatchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchState",
            "type": {
              "defined": "MatchState"
            }
          },
          {
            "name": "tokenEntryValidationRoot",
            "type": {
              "option": {
                "defined": "Root"
              }
            }
          },
          {
            "name": "tokenEntryValidation",
            "type": {
              "option": {
                "vec": {
                  "defined": "TokenValidation"
                }
              }
            }
          },
          {
            "name": "winOracleCooldown",
            "type": "u64"
          },
          {
            "name": "authority",
            "type": "publicKey"
          },
          {
            "name": "leaveAllowed",
            "type": "bool"
          },
          {
            "name": "joinAllowedDuringStart",
            "type": "bool"
          },
          {
            "name": "minimumAllowedEntryTime",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "JoinMatchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "tokenEntryValidationProof",
            "type": {
              "option": {
                "vec": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              }
            }
          },
          {
            "name": "tokenEntryValidation",
            "type": {
              "option": {
                "defined": "TokenValidation"
              }
            }
          }
        ]
      }
    },
    {
      "name": "LeaveMatchArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DisburseTokensByOracleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenDeltaProofInfo",
            "type": {
              "option": {
                "defined": "TokenDeltaProofInfo"
              }
            }
          }
        ]
      }
    },
    {
      "name": "TokenDeltaProofInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenDeltaProof",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "tokenDelta",
            "type": {
              "defined": "TokenDelta"
            }
          },
          {
            "name": "totalProof",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "total",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Root",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "Callback",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "publicKey"
          },
          {
            "name": "code",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ValidationArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "instruction",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "extraIdentifier",
            "type": "u64"
          },
          {
            "name": "tokenValidation",
            "type": {
              "defined": "TokenValidation"
            }
          }
        ]
      }
    },
    {
      "name": "NamespaceAndIndex",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "namespace",
            "type": "publicKey"
          },
          {
            "name": "index",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "inherited",
            "type": {
              "defined": "InheritanceState"
            }
          }
        ]
      }
    },
    {
      "name": "TokenDelta",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "publicKey"
          },
          {
            "name": "to",
            "docs": [
              "if no to, token is burned"
            ],
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "tokenTransferType",
            "type": {
              "defined": "TokenTransferType"
            }
          },
          {
            "name": "mint",
            "type": "publicKey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "TokenValidation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "filter",
            "type": {
              "defined": "Filter"
            }
          },
          {
            "name": "isBlacklist",
            "type": "bool"
          },
          {
            "name": "validation",
            "type": {
              "option": {
                "defined": "Callback"
              }
            }
          }
        ]
      }
    },
    {
      "name": "MatchState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Draft"
          },
          {
            "name": "Initialized"
          },
          {
            "name": "Started"
          },
          {
            "name": "Finalized"
          },
          {
            "name": "PaidOut"
          },
          {
            "name": "Deactivated"
          }
        ]
      }
    },
    {
      "name": "PermissivenessType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "TokenHolder"
          },
          {
            "name": "ParentTokenHolder"
          },
          {
            "name": "UpdateAuthority"
          },
          {
            "name": "Anybody"
          }
        ]
      }
    },
    {
      "name": "InheritanceState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "NotInherited"
          },
          {
            "name": "Inherited"
          },
          {
            "name": "Overridden"
          }
        ]
      }
    },
    {
      "name": "TokenType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Player"
          },
          {
            "name": "Item"
          },
          {
            "name": "Any"
          }
        ]
      }
    },
    {
      "name": "TokenTransferType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "PlayerToPlayer"
          },
          {
            "name": "PlayerToEntrant"
          },
          {
            "name": "Normal"
          }
        ]
      }
    },
    {
      "name": "Filter",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "None"
          },
          {
            "name": "All"
          },
          {
            "name": "Namespace",
            "fields": [
              {
                "name": "namespace",
                "type": "publicKey"
              }
            ]
          },
          {
            "name": "Parent",
            "fields": [
              {
                "name": "key",
                "type": "publicKey"
              }
            ]
          },
          {
            "name": "Mint",
            "fields": [
              {
                "name": "mint",
                "type": "publicKey"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "InitStateParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxResult",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RequestResultParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "permissionBump",
            "type": "u8"
          },
          {
            "name": "switchboardStateBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "OracleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenTransferRoot",
            "type": {
              "option": {
                "defined": "Root"
              }
            }
          },
          {
            "name": "tokenTransfers",
            "type": {
              "option": {
                "vec": {
                  "defined": "TokenDelta"
                }
              }
            }
          },
          {
            "name": "seed",
            "type": "publicKey"
          },
          {
            "name": "space",
            "type": "u64"
          },
          {
            "name": "finalized",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "RequestingRandomness",
      "fields": [
        {
          "name": "vrfClient",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "maxResult",
          "type": "u64",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "VrfClientInvoked",
      "fields": [
        {
          "name": "vrfClient",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "VrfClientResultUpdated",
      "fields": [
        {
          "name": "vrfClient",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "result",
          "type": "u128",
          "index": false
        },
        {
          "name": "resultBuffer",
          "type": {
            "array": [
              "u8",
              32
            ]
          },
          "index": false
        },
        {
          "name": "timestamp",
          "type": "i64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidSwitchboardAccount",
      "msg": "Not a valid Switchboard account"
    },
    {
      "code": 6001,
      "name": "MaxResultExceedsMaximum",
      "msg": "The max result must not exceed u64"
    },
    {
      "code": 6002,
      "name": "EmptyCurrentRoundResult",
      "msg": "Current round result is empty"
    },
    {
      "code": 6003,
      "name": "InvalidAuthorityError",
      "msg": "Invalid authority account provided."
    },
    {
      "code": 6004,
      "name": "InvalidVrfAccount",
      "msg": "Invalid VRF account provided."
    }
  ]
}
describe("anchor-vrf-parser test", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  // const vrfClientProgram = anchor.workspace
  //   .AnchorVrfParser as Program<AnchorVrfParser>;

  const vrfClientProgram = new anchor.Program(
    IDL as anchor.Idl,
    PROGRAM_ID,
    provider,
  ) as anchor.Program<AnchorVrfParser>;

  const payer = (provider.wallet as AnchorWallet).payer;

  let switchboard: SwitchboardTestContext;

  const vrfSecret = anchor.web3.Keypair.generate();
  console.log(`VRF Account: ${vrfSecret.publicKey}`);

  const [vrfClientKey, vrfClientBump] =
    anchor.utils.publicKey.findProgramAddressSync(
      [
        Buffer.from("STATE"),
        vrfSecret.publicKey.toBytes(),
        payer.publicKey.toBytes(),
      ],
      vrfClientProgram.programId
    );

  const vrfIxCoder = new anchor.BorshInstructionCoder(vrfClientProgram.idl);
  const vrfClientCallback: Callback = {
    programId: vrfClientProgram.programId,
    accounts: [
      // ensure all accounts in updateResult are populated
      { pubkey: vrfClientKey, isSigner: false, isWritable: true },
      { pubkey: vrfSecret.publicKey, isSigner: false, isWritable: false },
    ],
    ixData: vrfIxCoder.encode("updateResult", ""), // pass any params for instruction here
  };

  before(async () => {
    // First, attempt to load the switchboard devnet PID
    try {
      switchboard = await SwitchboardTestContext.loadDevnetQueue(
        provider as anchor.AnchorProvider,
        "F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy",
        5_000_000 // .005 wSOL
      );
      console.log("devnet detected");
      return;
    } catch (error: any) {
      console.log(`Error: SBV2 Devnet - ${error.message}`);
      // console.error(error);
    }
    // If fails, fallback to looking for a local env file
    try {
      switchboard = await SwitchboardTestContext.loadFromEnv(
        provider,
        undefined,
        5_000_000 // .005 wSOL
      );
      console.log("localnet detected");
      return;
    } catch (error: any) {
      console.log(`Error: SBV2 Localnet - ${error.message}`);
      console.error(error);
    }
    // If fails, throw error
    throw new Error(
      `Failed to load the SwitchboardTestContext from devnet or from a switchboard.env file`
    );
  });

  beforeEach(async () => {
    const maxTime = 60000;
    const retryCount = 10;
    const retryInterval = maxTime / retryCount;

    let isReady = false;

    const timer = setInterval(async () => {
      const queue = await switchboard.queue.loadData();
      const oracles = queue.queue as anchor.web3.PublicKey[];
      if (oracles.length > 0) {
        // console.log(`oracle ready, ${oracles.length}`);
        isReady = true;
        clearTimeout(timer);
      } else {
        // console.log(`oracle not ready, ${oracles.length}`);
      }
    }, retryInterval);

    let n = maxTime / 1000;
    while (!isReady && n > 0) {
      if (isReady) {
        // console.log(`finally ready`);
        break;
      }
      console.log(`still not ready ${n} ...`);
      await sleep(1 * 1000);
      --n;
    }
    if (!isReady) {
      throw new Error(`Docker oracle failed to initialize in 60seconds`);
    }

    clearTimeout(timer);
  });

  it("Creates a vrfClient account", async () => {
    const queue = switchboard.queue;
    const { unpermissionedVrfEnabled, authority, dataBuffer } =
      await queue.loadData();
    console.log(1)
    // Create Switchboard VRF and Permission account
    const vrfAccount = await VrfAccount.create(switchboard.program, {
      queue,
      callback: vrfClientCallback,
      authority: vrfClientKey, // vrf authority
      keypair: vrfSecret,
    });

    console.log(`Created VRF Account: ${vrfAccount.publicKey}`);

    const permissionAccount = await PermissionAccount.create(
      switchboard.program,
      {
        authority,
        granter: queue.publicKey,
        grantee: vrfAccount.publicKey,
      }
    );
    console.log(`Created Permission Account: ${permissionAccount.publicKey}`);

    // If queue requires permissions to use VRF, check the correct authority was provided
    if (!unpermissionedVrfEnabled) {
      if (!payer.publicKey.equals(authority)) {
        throw new Error(
          `queue requires PERMIT_VRF_REQUESTS and wrong queue authority provided`
        );
      }

      await permissionAccount.set({
        authority: payer,
        permission: SwitchboardPermission.PERMIT_VRF_REQUESTS,
        enable: true,
      });
      console.log(`Set VRF Permissions`);
    }

    // Create VRF Client account
    await vrfClientProgram.methods
      .initState({
        maxResult: new anchor.BN(1337000),
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        payer: payer.publicKey,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Created VrfClient Account: ${vrfClientKey}`);

    // Get required switchboard accounts
    const [programStateAccount, programStateBump] =
      ProgramStateAccount.fromSeed(switchboard.program);
    const [permissionKey, permissionBump] = PermissionAccount.fromSeed(
      switchboard.program,
      authority,
      queue.publicKey,
      vrfAccount.publicKey
    );
    const mint = await programStateAccount.getTokenMint();
    const payerTokenAccount = await spl.getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint.address,
      payer.publicKey
    );

    const { escrow } = await vrfAccount.loadData();

    // give account time to propagate to oracle RPCs
    await sleep(2000);

    // Request randomness
    await vrfClientProgram.methods.requestResult!({
      switchboardStateBump: programStateBump,
      permissionBump,
    })
      .accounts({
        state: vrfClientKey,
        authority: payer.publicKey,
        switchboardProgram: switchboard.program.programId,
        vrf: vrfAccount.publicKey,
        oracleQueue: queue.publicKey,
        queueAuthority: authority,
        dataBuffer,
        permission: permissionAccount.publicKey,
        escrow,
        payerWallet: payerTokenAccount.address,
        payerAuthority: payer.publicKey,
        recentBlockhashes: SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        programState: programStateAccount.publicKey,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .rpc();
    // .then((sig) => {
    //   console.log(`RequestRandomness Txn: ${sig}`);
    // });

    const result = await awaitCallback(
      vrfClientProgram.provider.connection,
      vrfClientKey,
      45_000
    );

    console.log(`VrfClient Result: ${result}`);
  });
});

async function awaitCallback(
  connection: anchor.web3.Connection,
  vrfClientKey: anchor.web3.PublicKey,
  timeoutInterval: number,
  errorMsg = "Timed out waiting for VRF Client callback"
) {
  let ws: number | undefined = undefined;
  const result: anchor.BN = await promiseWithTimeout(
    timeoutInterval,
    new Promise(
      (
        resolve: (result: anchor.BN) => void,
        reject: (reason: string) => void
      ) => {
        ws = connection.onAccountChange(
          vrfClientKey,
          async (
            accountInfo: anchor.web3.AccountInfo<Buffer>,
            context: anchor.web3.Context
          ) => {
            const clientState = VrfClient.decode(accountInfo.data);
            if (clientState.result.gt(new anchor.BN(0))) {
              resolve(clientState.result);
            }
          }
        );
      }
    ).finally(async () => {
      if (ws) {
        await connection.removeAccountChangeListener(ws);
      }
      ws = undefined;
    }),
    new Error(errorMsg)
  ).finally(async () => {
    if (ws) {
      await connection.removeAccountChangeListener(ws);
    }
    ws = undefined;
  });

  return result;
}
