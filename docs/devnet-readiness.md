# Devnet readiness

Run started 2026-10-02T09:35:12.628Z, finished 2026-10-02T09:47:59.345Z. Written by `scripts/devnet-run.ts`.

- RPC: solana-devnet.infura.io
- Keeper: 6XzCECNR9AHP4VmEKrasgcowcANVFD6WTm5vjdESrpQa (6.6537 SOL at the start, 5.5278 SOL now)
- Wallet A (creator, trader, 1d staker): H3xnCT3AUMnrd9kgPHQoESFRjceAVibFCebPhvTheBkA
- Wallet B (7d staker, exits early): gKjoGC2U1Tk7oTqDvyvgw4pypDzuYhuWN8JEe2KXJBa
- Launch: DCAT `Hs62cYBA37kPjQni8BcC3Z4vv4mWTbqA3fJCpH37c9N9`, curve `B2gYzDqpVu9VwTU7kzjHf3dqQ6tAk5qUGWnykG1yMV1Y`

## Steps

| Step | Result | Wallet txs | Keeper txs | Fees (SOL) |
|---|---|---|---|---|
| fund wallets | wallet A H3xnCT3AUMnrd9kgPHQoESFRjceAVibFCebPhvTheBkA 3.3428 SOL, wallet B gKjoGC2U1Tk7oTqDvyvgw4pypDzuYhuWN8JEe2KXJBa 0.2000 SOL | 2 | 0 | 0.0000 |
| settings | kept settings version 1 | 0 | 0 | 0.0000 |
| launch | DCAT Hs62cYBA37kPjQni8BcC3Z4vv4mWTbqA3fJCpH37c9N9 on pool B2gYzDqpVu9VwTU7kzjHf3dqQ6tAk5qUGWnykG1yMV1Y, 3% fee, basket dZEC 50% dJUP 30% dBONK 20% | 1 | 0 | 0.0000 |
| trade until staking opens | staking opened after 20 round trips of up to 0.3 SOL | 40 | 18 | 0.0002 |
| keeper pass after staking opens | confirmed so far: claim 4, split 4, rent 1, swap 3, fund 0, payout 5; 0 errors this pass | 0 | 0 | 0.0000 |
| stake from both wallets | wallet A staked 72337437764551 base units in 1d; wallet B staked 63149226444408 base units in 7d | 3 | 0 | 0.0000 |
| exit early from wallet B | wallet B left the 7d tier with 63149226444408 base units staked; 44210773433731 came back | 1 | 0 | 0.0000 |
| keeper burns the penalty | burned 18938453010677 base units of DCAT https://explorer.solana.com/tx/jM2qBJCgFbtz3dqzgYutx5QggoArr6kT8LtbuzqFVa6uFgwUorPQz5FqbdezK4GgmWMG1UbHRUkLAZcky1cQ93t?cluster=devnet | 0 | 10 | 0.0001 |
| payout to creator | paid the creator https://explorer.solana.com/tx/5VhGcySTLuREo3ZAW28e3FcZz5vFZfTZo7eMBhQii9ms2XoPj8TxnGn9iJ32ShjPSPQX2LFR6cEbAjuaQ1LvxVNL?cluster=devnet | 0 | 0 | 0.0000 |
| trade until graduation | curve raised 2.0000 SOL of 2.0000 | 1 | 0 | 0.0000 |
| migration to DAMM v2 | graduated to DAMM v2 pool Epiwc6v3g9fbXykx1yfUU6LmoMtypecLsnPpDPPxrG1X, migrated by the keeper https://explorer.solana.com/tx/45Rim3iGmYsKtUtJ7keN8xdhfJ18AmrbrJTrRfEcp8w7ESwvjaq7FAF1dcrGvsb6AiSDs6VAox6yB6HZ9yNtJMAt?cluster=devnet | 0 | 10 | 0.0001 |
| trade on DAMM v2 and keeper pass after graduation | sold 332256631081434 base units on DAMM v2; keeper pass: claim confirmed, split confirmed, payout confirmed, swap confirmed, swap confirmed, swap confirmed, fund confirmed, fund confirmed, fund sent | 1 | 8 | 0.0000 |
| return wallet SOL to the keeper | wallet A returned 2.2117 SOL; wallet B returned 0.1432 SOL | 2 | 0 | 0.0000 |

## Keeper passes

- 2026-10-02T09:37:04.871Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x1
- 2026-10-02T09:38:27.409Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x1
- 2026-10-02T09:39:53.714Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x2
- 2026-10-02T09:42:09.973Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x1, rent confirmed x1, create_farm confirmed x2, configure_farm confirmed x4, swap confirmed x3
- 2026-10-02T09:42:20.046Z (keeper pass after staking opens): no steps
- 2026-10-02T09:43:36.338Z (keeper burns the penalty): claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x3, collect_penalty confirmed x1, burn confirmed x1
- 2026-10-02T09:44:38.589Z (migration to DAMM v2): migrate confirmed x1, claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x3
- 2026-10-02T09:45:07.578Z (migration to DAMM v2): claim confirmed x1
- 2026-10-02T09:46:51.418Z (trade on DAMM v2 and keeper pass after graduation): claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x2, fund sent x1

## Different from localnet

- Swaps go through DAMM v2 pools of stand-in tokens (dZEC, dJUP, dBONK, dWIF, dCATE, QUANTS) against SOL, with real on-chain swaps and a minimum out, instead of Jupiter (mainnet) or minting the output (localnet).
- SOL and devnet USDC are priced from mainnet Jupiter prices; stand-ins and QUANTS from their pool price times SOL.
- Graduation targets are low (2 SOL, 300 USDC) so one run can fill a curve.
- Token to token swaps have no route, so a QUANTS or USDC launch only buys rewards with the SOL left after its rent swap, and a USDC launch cannot open staking (there is no USDC pool).
- The keeper's slippage cap is 5% (mainnet default 1%): the stand-in pools hold about 0.3 SOL a side, so a keeper swap of 0.01 SOL already moves the price about 3%.

## Transactions

- fund wallets, keeper: [2w6R29ro2oBwJK9Q...](https://explorer.solana.com/tx/2w6R29ro2oBwJK9QrxRz5JCQHK5Ckm3bYz1F3h16cMAqCSuwtEpqJEiTKrLhZ3wLpLn1UVXRvudKo56bET1pgrqv?cluster=devnet) fee 5000 lamports
- fund wallets, keeper: [2aoRJ9BnqZE3v1Ls...](https://explorer.solana.com/tx/2aoRJ9BnqZE3v1LshD7VsyXp21H1YVXorx6HZkDTVDLAFUje6U8zzENi5cyHBt1SyETq5ieyfejNLXgmow9hpB6e?cluster=devnet) fee 5000 lamports
- launch, wallet A: [EWCogkQ5QR7Q1yue...](https://explorer.solana.com/tx/EWCogkQ5QR7Q1yueUTk9VSq1SyjFmWXo5Fw7wzoJnc88M465SgNrfFZXD5T96hGzW1KtZRi7m9RVVGzX9YvbTQd?cluster=devnet) fee 10000 lamports
- trade until staking opens, wallet A: [4PzLFWLiiqkhmaXJ...](https://explorer.solana.com/tx/4PzLFWLiiqkhmaXJY6Ru5uX5MshHtnsF9mHR4bQN6DG2aEftx4RE2vsmf71XUsKCCk6aNjEF7nGZECvCz38cCvdj?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [2QzAUpgJy2CHuv9X...](https://explorer.solana.com/tx/2QzAUpgJy2CHuv9Xve8iZQiBGC9fD6WKmCVQfGLCy57Fk9Ye6q269VHcs9g9D8T7b2fXSUjrMcHYUPikNdPpZCdZ?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [66akd4fxPyZ4ysUV...](https://explorer.solana.com/tx/66akd4fxPyZ4ysUVecBfBKR6g4ZVxg8VzDQ7Mm8t9CZeABcP1Efzy74sY9NLEZ6SmvFxs9MrN8jbJhqTgqF3GWQA?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [p8yVHSaqEGSpHZu4...](https://explorer.solana.com/tx/p8yVHSaqEGSpHZu42BxvTvDLJ4ThW4sDg4UuLQW3siowky61qS6S41a1hs6VLTVnrPgkL9CSTHqhDncu4SDL9kJ?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [5Ym5Q9CSCoi9HUPe...](https://explorer.solana.com/tx/5Ym5Q9CSCoi9HUPeutXsppn1HGr6u4dS32ssgRdGNVnLSTaq8BeR1tRRiocwa2YfDbw9bqMNHZNJX4wrLhLh4Yi6?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [zGtSsoKRKgnzLyWS...](https://explorer.solana.com/tx/zGtSsoKRKgnzLyWS4D5ub6i9sgTfioWCVbbve1otDSd4eLjpxtkidsAa1cGehFjrLWaSqcvRRSCYB34jNjicwkn?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [39voYfB5ZfwXRuwC...](https://explorer.solana.com/tx/39voYfB5ZfwXRuwCeTQFgVAZtfkWvcweAjammUvFjpW4kg8TkAc45fNBpVupj95PuKddgLAcKDH3MtzcR4rNUgGy?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [28pobnApH5evoqmf...](https://explorer.solana.com/tx/28pobnApH5evoqmfSSmRzGwqYLzRQGceYiyFAHG81j9WAmosEcTfFwohYwGSwqmknmEVJVyiz7axhzXRmcZf3wEA?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [5YQ3ey8uWCWHPttp...](https://explorer.solana.com/tx/5YQ3ey8uWCWHPttpP4DPNLg85U95WrgC9CC21nvpbwLUhzehvenMbvgpc4XXTp3Yh4roRiHj7CgiWbqKP1gxGBVa?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [35yk6QWPpEPU8DPG...](https://explorer.solana.com/tx/35yk6QWPpEPU8DPGxEUBHiu4wqxxkvi1FqMrAw11NK6A2Xb2V3FtKTsR7jJanRXqzHgP6LfjRJXF3omaAXcQkL2R?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [T6KiKXD9X3QqhuWy...](https://explorer.solana.com/tx/T6KiKXD9X3QqhuWymX5SmUD2MfNyV6vSdZJKm1RmiyPtaAE8dM5EgkCv9DBxznuxSx83DzDEnd9J8rzvS5AcvBF?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [sknPWNuncxJBkTf8...](https://explorer.solana.com/tx/sknPWNuncxJBkTf8XZu4isDd4qQEbP7YA2dZ7JqcZwYNhserxYRbJgHYXZevNEXyUKUjXnY2bK97zcZtTinR2yC?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [w6c5MB4a1TMCRV8x...](https://explorer.solana.com/tx/w6c5MB4a1TMCRV8xaA6nQBMoh2P1gpQwEaSu8MsfUastLv6RwsxAbG9PxpX8MJXKc3a1iCEKYqPHDWrNBRSfjCd?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [3qRBmMempKngRJY5...](https://explorer.solana.com/tx/3qRBmMempKngRJY5kDrCt8V3tRXyDz4SUDmYcGarn8VNHvogTfLxvbRitEB1KmDVqWFdN8VdJgvpwQFMdCjx6jT1?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [5dJN6zPghyhm2hSH...](https://explorer.solana.com/tx/5dJN6zPghyhm2hSHQDdDzkyZ44EzYNj81dTM2MS2AqWdRkuXnCL6uuk9CL81PNk946uJG4djQ2kr94Dpyd2gL66g?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [2AWQEmJNwjBh2sBL...](https://explorer.solana.com/tx/2AWQEmJNwjBh2sBLbLgab7nYERFv3MaiJRyv5jM6HytfF6xiz3MgW4cgTXXFqomUtw2UqNyxtDvsSHgqdMJBuYdX?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [2SCJmwaoovCorMeZ...](https://explorer.solana.com/tx/2SCJmwaoovCorMeZcvHE1mvBxpxPo79yrFs786e4Eo1iWw2MzWCjRNWRfji34gqL71MZfEhDAHkY7FetEex5nSU6?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [1zBhVmDFDXJQZhFs...](https://explorer.solana.com/tx/1zBhVmDFDXJQZhFsUCCTjuZnGWks2sfhf35Nw2MafvBvUL6Vmq8663Qv2GT2d6kx9rPVcVy3Tj2AdzPxoshrQnn?cluster=devnet)
- trade until staking opens, wallet A: [4QYUzMD7aYoDgLN6...](https://explorer.solana.com/tx/4QYUzMD7aYoDgLN63Tsm3LpPLTkaNJDkdUPSrMQWtjqh3UgfdY3UHPhrxAAgNi54GQMTfnkjjPKkdzLwJbhDViYS?cluster=devnet)
- trade until staking opens, wallet A: [2ShxxEFR1tu6gRs7...](https://explorer.solana.com/tx/2ShxxEFR1tu6gRs7ztEcuzpQEomePuocE86KDyDypZviE8hJVcxNVer3xrc6YcpBwjngvYzQqkiZjFi3VzGn3eK8?cluster=devnet)
- trade until staking opens, wallet A: [32PvqTMpwh66CfKa...](https://explorer.solana.com/tx/32PvqTMpwh66CfKaDh3KH9BVxH7WMDFaDSQNMKRGD3WsoM3W3SHTzXodsxAuYZBjmt3ahS7akrRWSnEf2P9tTwd3?cluster=devnet)
- trade until staking opens, wallet A: [2PvRhgbEDtxj1Z5J...](https://explorer.solana.com/tx/2PvRhgbEDtxj1Z5JqMnPCUkQQN28ke9tvfrX81LBbwnnH7Zngi6Vt1z1k9WCGCA6juXv8qaZpFcjaZDzB8gWcyyH?cluster=devnet)
- trade until staking opens, wallet A: [3sGFBzoxeJuSWD1o...](https://explorer.solana.com/tx/3sGFBzoxeJuSWD1orivgjZjzZmtLr5q9HgR7y1TGMxF6UktYvWTqHMgcFcRmTxfTdu8x7xZ7qZvGrCzsYAnEJz8R?cluster=devnet)
- trade until staking opens, wallet A: [5FzmRnhniNwSL9b9...](https://explorer.solana.com/tx/5FzmRnhniNwSL9b9NoVq5Wd8ZCtAyA4aE2wdaZAmE475aHZz1XXmo546fzSBjFu3o8TkTSfu6k7ebmjfdKKSHCMX?cluster=devnet)
- trade until staking opens, wallet A: [5ndEez6AzKVNzn9T...](https://explorer.solana.com/tx/5ndEez6AzKVNzn9TVDLZQMFyKMNi6tyYVcGtemRPEqZoRMoknzNp562Mvz7G6dcbyLXQxBWtdJBSAq7xB6JVR9jB?cluster=devnet)
- trade until staking opens, wallet A: [MdBwv3cTY4sCwihe...](https://explorer.solana.com/tx/MdBwv3cTY4sCwihekPch9QYf6uTR1oSQQefFyNbEuqezjAHyCc1mBj8aRK7rNe2EGhFgRg69qSmBw3BDHL5pqfp?cluster=devnet)
- trade until staking opens, wallet A: [2WyQcBfoFBZK8ix9...](https://explorer.solana.com/tx/2WyQcBfoFBZK8ix9u8YKjVe4zJdhs7CagVKJvMRDJAsaAtVLuM8J1qE79CYuooWHGeUmEwBRqYEsBRfUguRCpkeJ?cluster=devnet)
- trade until staking opens, wallet A: [2S8sk4Cgq91kdiSD...](https://explorer.solana.com/tx/2S8sk4Cgq91kdiSDDVD44yAc1PHnwTJbJZ47nP7eJrKKxKA4f96j3WgRtaGtZZvJN6EnHLTbWnDrRF8QyRr1m6e?cluster=devnet)
- trade until staking opens, wallet A: [5BKi165Wb2ABqVeb...](https://explorer.solana.com/tx/5BKi165Wb2ABqVebcjSC8ZsqrhfpJArjfVFyM9LGDoKwVLsn8pLt7mJyeiojbYrvyskeeyyy3NfNSM7sNGtGKzKM?cluster=devnet)
- trade until staking opens, wallet A: [K4kkWx5kquHfQtbU...](https://explorer.solana.com/tx/K4kkWx5kquHfQtbUeAb79aRKTJaXFT65budDe8RjXGxuM8wLLdngAEMNUpxpk4UbgeS3uVpecHJ9xpeH1fdr3YK?cluster=devnet)
- trade until staking opens, wallet A: [2Goyza28VvFBJn98...](https://explorer.solana.com/tx/2Goyza28VvFBJn9872RkVN54VPWoek3zmgNHyNegY2Q4bQF8D5nEgZCh7JowSvjd4dWvV2jAGY8HzGBqh19XFCwq?cluster=devnet)
- trade until staking opens, wallet A: [3fSYPYEzTq71NVF2...](https://explorer.solana.com/tx/3fSYPYEzTq71NVF2Dr8eLT2o71caEArn7BhMT6ChzQZqUVysk1qJo5ZyCSHwsvq2j757zNnJbr2eUtJuyUVnz85n?cluster=devnet)
- trade until staking opens, wallet A: [2tPDo9TmK5AabwcV...](https://explorer.solana.com/tx/2tPDo9TmK5AabwcV3tDFoyZggwNqKydUEZ6Aq5Kq4WSkJ5SBzJQe26oa8GJbaMuYcBjAuWa5CYoLLWxzQUuZRDfz?cluster=devnet)
- trade until staking opens, wallet A: [45wTM5LEv5zzqV9j...](https://explorer.solana.com/tx/45wTM5LEv5zzqV9j8y1Yw78ssqyCwqBxM1r77PwqoZ9dyxZLr9U4t8kvJHCWvEyr3eZRwqEo4ufjqVY5puapVD9R?cluster=devnet)
- trade until staking opens, wallet A: [2CmELQ6n8U2Kpe3u...](https://explorer.solana.com/tx/2CmELQ6n8U2Kpe3uBCyB79oi9Y7xsKw6CdusnPh6SGRZvTgFcLinxACJc2RXB2z24NhuqzYzRxpLpoWAZn3tKpbs?cluster=devnet)
- trade until staking opens, wallet A: [6GvDnQysi52aB6hM...](https://explorer.solana.com/tx/6GvDnQysi52aB6hMX88fKFb9u3vCZX4ydeeUgnrhP8NeyjLUiJw61PKHnCFWucfgog9E6MPZLBNRUStLBvkwaEn?cluster=devnet)
- trade until staking opens, wallet A: [2ZMpmmB25rGtxbcq...](https://explorer.solana.com/tx/2ZMpmmB25rGtxbcq2QZC4NFawzTczbQ5Gx3eJEEJ3YZJ8UBvUTMdGkFFQrEYDCutDGouQNTTznK8Q7CsBRCWoxGD?cluster=devnet)
- trade until staking opens, wallet A: [3nS7FAhSajz4xSAQ...](https://explorer.solana.com/tx/3nS7FAhSajz4xSAQNLD8rhzZf49Vmty4HkP5rC4moitEY5Md71HQ7fLntUmg4f3yAYHm21X94CTp3TR5i3egEnYP?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [wEEaATJXF89fdgop...](https://explorer.solana.com/tx/wEEaATJXF89fdgopCc9nDDCE3fdZSMUezfr7YYT9Fkd5L6mMWqWEdWjn1k8iadAt9BGGVgwXKc7kQAduQnJ8eHj?cluster=devnet) fee 5000 lamports
- trade until staking opens, wallet A: [3d3wtEd4vNPYsyka...](https://explorer.solana.com/tx/3d3wtEd4vNPYsykaBraYpdaya3MiuQTtoN9y6im3YMUEdK3Q9KxqGpfpBcqPZoNNzUm3WLc4W62kiUMyS5Wzsoes?cluster=devnet) fee 5000 lamports
- stake from both wallets, wallet A: [3wMJuijNYZTxZG1G...](https://explorer.solana.com/tx/3wMJuijNYZTxZG1G85GFrxR4fpo4qwf32qZP51dHMdaa8pC3yXWvKtozxN3vwetuCT1kyATGnetFgWoZArc3tre4?cluster=devnet) fee 5000 lamports
- stake from both wallets, wallet B: [629C45nrsWwWazQx...](https://explorer.solana.com/tx/629C45nrsWwWazQxvnG4imqAKDY4xGutgBYisBBxqcbJRRiNKzLRpVDYYya9gb6cGunKtEiFqKxDTSqhFmB4EJvd?cluster=devnet) fee 5000 lamports
- stake from both wallets, wallet B: [47FyyiU33LTgFYys...](https://explorer.solana.com/tx/47FyyiU33LTgFYysgisipBueLsTGgg1PKtDEBhCxkd8sgepZW5zCgWD1tyUQvRAFWkbhLVQFPjUKkAapXf2BXr8d?cluster=devnet) fee 5000 lamports
- exit early from wallet B, wallet B: [3fLSa3MAix4mDWu4...](https://explorer.solana.com/tx/3fLSa3MAix4mDWu4KeKgJtXWAzcM2aekaz9m1tJZufNtB9r6wrza4qFJuEXc87LxQddh2uQG24EMHDqjgqmQLNjm?cluster=devnet) fee 5000 lamports
- trade until graduation, wallet A: [D9Ej9ZPeR7w5KbKB...](https://explorer.solana.com/tx/D9Ej9ZPeR7w5KbKBc9ouDfy54Erwjxb43uN8YJ6bHefbaSeig4Mzaa6q3x3bCEpZ17krfDPqaBXLvXLRi7K4Sua?cluster=devnet) fee 5000 lamports
- trade on DAMM v2 and keeper pass after graduation, wallet A: [4VBAsW23uchKfCt9...](https://explorer.solana.com/tx/4VBAsW23uchKfCt9JE3J9n9hQuB62ZNLgn8r5cFazaZ6eERjoAPhBwimccoGZiEYHgYunnfTeJyMRx1vUx1kG4ZH?cluster=devnet) fee 5000 lamports
- return wallet SOL to the keeper, wallet A: [3cj1pmWB3YoJ7YRt...](https://explorer.solana.com/tx/3cj1pmWB3YoJ7YRtkv2NyMKbi2zLHmdFMiYmfvkM9Xg3XAWeWZdEgFauErxsA9mMJpPrN2GqJxvGLSG6LPhiLdQt?cluster=devnet) fee 5000 lamports
- return wallet SOL to the keeper, wallet B: [5UzaYbaT5qdj89a5...](https://explorer.solana.com/tx/5UzaYbaT5qdj89a5MTzq8mc8swyuhi8tEfLaVfeMHensBZoPVrBKTfkJTP7PM7dcZhPsmCFfiUAiGkAnsHJpfo1N?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [2mRDWBpJogveAi2c...](https://explorer.solana.com/tx/2mRDWBpJogveAi2cBJcYjMUcnkArDaLaSaUNLr5AwfuTERWtdzUHa8t2o7Jj3ZVQreD13NvSA47QsnvgvKWV4cWo?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [5VhGcySTLuREo3ZA...](https://explorer.solana.com/tx/5VhGcySTLuREo3ZAW28e3FcZz5vFZfTZo7eMBhQii9ms2XoPj8TxnGn9iJ32ShjPSPQX2LFR6cEbAjuaQ1LvxVNL?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [3B1MFAmEQeVrT3FJ...](https://explorer.solana.com/tx/3B1MFAmEQeVrT3FJwfsp3cPcDMZS31tNYbras74juubmT1h5ws2piD1V242dgaLPvb1rAKDZ9Dog6or6HJFmHQaK?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [43CRuskuuMye2wFw...](https://explorer.solana.com/tx/43CRuskuuMye2wFwUwgz1ZW1itdmLu8ePt7Xx19fNteMMdbqS2CFtdb4f5Q5XhLRZV5DEPfTyX8KVW27SHZMTXu?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [5N72aSovsmNT8zb2...](https://explorer.solana.com/tx/5N72aSovsmNT8zb2wysMbLmniygBicWr43zuWSfMv4xwUT44LmNEiL53f2S3AAFSZKhTJZusMDUFaMeed5FvnSG7?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [4yCAbXkt8v4bGfFp...](https://explorer.solana.com/tx/4yCAbXkt8v4bGfFpYNyPLWsiLoBq3k7m8WKndwXMmhJdhY8hYwqL6vQx5DAcocDcFabYNw7TCCmTWt4fTrnbivMX?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [2f37Ntww7qzzCz1A...](https://explorer.solana.com/tx/2f37Ntww7qzzCz1ACwBKcqUh6oEcm7vcty7kFCxNqj2WZnUx9dDUqN6XQczS8sEcZ42A3R3QkjZQRJpdyv3ycJEv?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [49bD8JAkJtWxG6Ci...](https://explorer.solana.com/tx/49bD8JAkJtWxG6Cif1iZ2zgTz1uM4dSa5q4F1ThKZro9HUZsrkESJrTya1CTksdjJGLeRRnLyyvmSq93zGZJ7DA9?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [4zmh1amzG1iyEfiJ...](https://explorer.solana.com/tx/4zmh1amzG1iyEfiJww21ZMHAReNULmnu6ukaeXetZyS1MPuRBMFDLRFkbC2zWTTSX3yXnZAJ48qyFq92YtT7Vfwr?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [3qNZBA68zBhCPeNN...](https://explorer.solana.com/tx/3qNZBA68zBhCPeNNZYH2Ntw4hX18kzF3LdHf9dC4mfeQjhFo5s2k7gEfXYS2bcvPw7H2BjQZbritx9GMnabqZEUL?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2MqVV3epEtJd8Hkv...](https://explorer.solana.com/tx/2MqVV3epEtJd8HkvCvbixhqu4ipFe5sed5EVfKBN7b6GUfYcVuchusVw4aPbpuyqP4XFr8S4J3jAVqy5SvFECvCB?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2boh5tRsZ6dFS2vy...](https://explorer.solana.com/tx/2boh5tRsZ6dFS2vyrE8RJA1MnrYgp31pTik5jPrHaRYzdFVv9J8ieqLsLSNEgdXspLAfiyno6Da3gnWUQYpTpxWe?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [2Pr6e3e3rkzp9GKw...](https://explorer.solana.com/tx/2Pr6e3e3rkzp9GKwbkRZ2e3c8obqFCUPaFzkfq5JauCPq4ZurUvWq98NsFVqUWWXV9HDPtpEBgXEJ9wGhi9tqeJD?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [4xuNi5HDZ9SJUcJj...](https://explorer.solana.com/tx/4xuNi5HDZ9SJUcJjSRvwJqNDH82nGbmBpUZAtX75RYAfJ9VKsEj2cxK6EDh8oVTdy2KYVj1TeKpHULrFSS3ToUnw?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2Sqkbd1qwcc2eeYu...](https://explorer.solana.com/tx/2Sqkbd1qwcc2eeYuni3QHQj489G5GgW7vEnkvE4yYEAS579ba48HsX57p4SsyQAequdHuc78EpdAokYZ8aME6ZHE?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [5jvydsB9mTwLSD6X...](https://explorer.solana.com/tx/5jvydsB9mTwLSD6XLSvhBHtScfg5RfDxY2CfNNM3dijkta3PKLmyjCGV8fWegWzSZtw4nkRVoh6YGG8XbyHq3H32?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [2Xz2C1VToDwwcGwx...](https://explorer.solana.com/tx/2Xz2C1VToDwwcGwx8o53TsnPE4ghPmJCQiXT7HANEXDVDUVftLpHyr3RayHoTeBBxYvav9BpezKzffZBRohRbwmm?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [5Uchnwo7VckvMnYX...](https://explorer.solana.com/tx/5Uchnwo7VckvMnYX298DZZE25Zb2Uj8RqQxwj3VT9EGSC14m4CzvFxvdQyoxVA4fBPEpP8YsmxSuhZkDVW1REoWq?cluster=devnet)
- keeper burns the penalty, keeper claim confirmed: [2HGoxBfAHQioeaoD...](https://explorer.solana.com/tx/2HGoxBfAHQioeaoDohqndTwupni3MPtQdD8Sk16cVWpSuGe8FHykN5pzbDXLfjkeuiBARAbyaFys6YaMf3BDqeSi?cluster=devnet)
- keeper burns the penalty, keeper payout confirmed: [3SCGgp6nzo79Khb7...](https://explorer.solana.com/tx/3SCGgp6nzo79Khb7LkHNbwW5Jqz2SYieFaDTo6ZNd6XYztej17eyJWrGp1zqVUpextEs53W39KoxC4Mj7idfkqnx?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [pbcXkyDt5aWPHowf...](https://explorer.solana.com/tx/pbcXkyDt5aWPHowfWX7jZk9g3zto4njGEeBh99RkSX997hjTyf3DTLwPmN66HrR9jkAG5Lgt2zDHaLSGma4RepP?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [yvx7iPEaDqP7Ghu5...](https://explorer.solana.com/tx/yvx7iPEaDqP7Ghu5uD58f9KJfyTbAzHMJHxC3VqiSWJWDycP2C8ahS2X18GywBpEXuQ55P6faTJYpQnSGR6RKAj?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [2MBM1j5zHFq2qzCv...](https://explorer.solana.com/tx/2MBM1j5zHFq2qzCvNxkJGhHkRB8r35X32eXsMVMF4Z682SNXmyV81wMLQ8rHag2gPfhR9GUSMc6VYADNWKpavBXU?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [WdTUJ4yCaq78nbcw...](https://explorer.solana.com/tx/WdTUJ4yCaq78nbcw2yg9ufeY9oTHDPuFZVKwyoH5d2BE5Fkws22fWauiMbDdpRBNe3q6DQLyCJdwi7bAyprpKrb?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [9LYg2faPUXKYYtfR...](https://explorer.solana.com/tx/9LYg2faPUXKYYtfRkwAFyKXtJqVkvVm1gEvReGPK9AaX4ENnjxKpMgn32SCjdVK6wbRsZ1KZB4SmT9rftHTDvBN?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [dGnCxj5xoDefRY5q...](https://explorer.solana.com/tx/dGnCxj5xoDefRY5qtethfVer8ERNmfRFPYBPtYqjaELFWSg9NeeRDcph9DdQrn68w648bf3BKaKQniKVH3ZVnze?cluster=devnet)
- keeper burns the penalty, keeper collect_penalty confirmed: [591Jype9V4dvxwxp...](https://explorer.solana.com/tx/591Jype9V4dvxwxp6i52uHmtAqWCcSkxkMymR5qLDQTiEMz2HKnEg9WgCt1zEp79QTamMqkdjE5KBrQtHc3To6xH?cluster=devnet)
- keeper burns the penalty, keeper burn confirmed: [jM2qBJCgFbtz3dqz...](https://explorer.solana.com/tx/jM2qBJCgFbtz3dqzgYutx5QggoArr6kT8LtbuzqFVa6uFgwUorPQz5FqbdezK4GgmWMG1UbHRUkLAZcky1cQ93t?cluster=devnet)
- migration to DAMM v2, keeper migrate confirmed: [45Rim3iGmYsKtUtJ...](https://explorer.solana.com/tx/45Rim3iGmYsKtUtJ7keN8xdhfJ18AmrbrJTrRfEcp8w7ESwvjaq7FAF1dcrGvsb6AiSDs6VAox6yB6HZ9yNtJMAt?cluster=devnet)
- migration to DAMM v2, keeper claim confirmed: [3GahSUzHTGnK9eXG...](https://explorer.solana.com/tx/3GahSUzHTGnK9eXGHQ7csiEM6to1SZCeFvBTPWhsVDjhZBLsncQAjNecrq7PSxEdD1gUGutCBJhzGXqJArSSpsfW?cluster=devnet)
- migration to DAMM v2, keeper payout confirmed: [2Ed61nFHZZhNYycT...](https://explorer.solana.com/tx/2Ed61nFHZZhNYycTJM57ykWZomMFRMvn5b3c1ZHptT1YmsqQN7yu8wgoMmbZtHjEchUCVcH22s2H76N9a7gwQ9RS?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [5uaJcToeP8CCgQ9N...](https://explorer.solana.com/tx/5uaJcToeP8CCgQ9Nz4xYXTH4GXkh6fB3g41XPXe6touto2EU64PR1LCF5mLSFt3fARL5osaYYotzpgJ7cReX8csp?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [5keMVbAKg9LRMmiU...](https://explorer.solana.com/tx/5keMVbAKg9LRMmiUCBT9dbFwFhBYMNk2kyeAVSBVH3Aez1Q1xvccZcFxDmakTscYMhwAWqsXQbycNMG3maCka8gw?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [9vsG5Hx7oRXAzXrP...](https://explorer.solana.com/tx/9vsG5Hx7oRXAzXrPjwVcRMRLDCMncKw6KnataVuqjn4K9LVtJd1928t4KwYMpGrfKARcgAbg3sxsr45pTQKjyzn?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [m7zpHCTYimmqw3Gd...](https://explorer.solana.com/tx/m7zpHCTYimmqw3GdnEa48XgSnRFd7Z2buef3DyomDZFYGdbiuqZmfJHfAPZ5YJVsaXzZBNeiaWiFgB3pRhQH9Vd?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [4ZbEkEbqgVByFKcn...](https://explorer.solana.com/tx/4ZbEkEbqgVByFKcnVZyxkpd38a4hBjRKtyxXKA7C16hQ89HfNovpipDMGWR6WCNpUoZYqErqZyWVYJHxPM1XuW59?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [5VH2szyuuQtEEzYo...](https://explorer.solana.com/tx/5VH2szyuuQtEEzYo76fnDrRuoqyq47S6s9MDJY9Y8ybxNWXaRrYNzzayR53LSj16WMckyfGs6CG5N9rKKsP5K3wx?cluster=devnet)
- migration to DAMM v2, keeper claim confirmed: [3cCZs1kCKhhUtcZH...](https://explorer.solana.com/tx/3cCZs1kCKhhUtcZH4aE3jTfTbgNCqiqKmRrBYWjBCiDs3zJycQ7uGq8Rpp4uqMh6SXWtW6hV8q5MCo4RPQCbsSTA?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper claim confirmed: [5kLTveBUbU75E1Yq...](https://explorer.solana.com/tx/5kLTveBUbU75E1YqA5sckYV2JDHNuP4BiXWM4iY1pwYigogz2uXf3K3fUhxVfSYZ2RiwbE272bQ4rLygWNo3LRmN?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper payout confirmed: [29TD2dHZcMAvogae...](https://explorer.solana.com/tx/29TD2dHZcMAvogaeraYFUCuEsdD84pBZbdDNtBgz398YUAtJGjw3DdS8WB13aWt9BZm3NaccydAMBL8igahvcpNW?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [3rU7fpD3Yd8HvTSB...](https://explorer.solana.com/tx/3rU7fpD3Yd8HvTSBHcbXkJ7FsTWUnGhyJYnH54knwPUwjTAyhpPX7RG9ja5sSkvRRnnUnBRq96VSVFWPU5d6Wxo5?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [4FFmc2eUPUajxeXh...](https://explorer.solana.com/tx/4FFmc2eUPUajxeXhqkJrDQQjXUqfNz4ezGXMD63itdNLrftoV27ZoroZyiXWB67p3rusrdEbjNBcdwMtXmWe7YQQ?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [3JtrJB7ZqY5CYiNC...](https://explorer.solana.com/tx/3JtrJB7ZqY5CYiNC7hKr86mszuRTk1yYanA45eUqmv5xPKWvssMh35X3jhCCVEeSHu7HrnLnVfijYkhSvsKmLDFo?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund confirmed: [3kDhuSVVbb9PNfKm...](https://explorer.solana.com/tx/3kDhuSVVbb9PNfKmrAjddLmEG2b5bwGgNf9V1LVWXEACvX6yDr6NUMbwNSuT8JMkZWE5ezYaebvCVLGLaD6KHqmF?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund confirmed: [4ABQWHkfke7ugAiW...](https://explorer.solana.com/tx/4ABQWHkfke7ugAiWYPWHyVcHYZo4A3Hrd6VUEJPTZAYp6zLAQpZzzgMDgfhZmhPA5owTFtp1ZhWnmjFj88SMDmfu?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund sent: [gJKm7ZPpVe2b5TwV...](https://explorer.solana.com/tx/gJKm7ZPpVe2b5TwVE6WQ5CSdbhVuDxESXceVZ72Fx7xfqUzFVTsQiBSnuKJyXxpAfMkEEBJA5Pppu11uNQaDapi?cluster=devnet)
