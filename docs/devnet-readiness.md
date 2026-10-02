# Devnet readiness

Run started 2026-10-02T08:58:38.073Z, finished 2026-10-02T09:15:44.095Z. Written by `scripts/devnet-run.ts`.

- RPC: api.devnet.solana.com
- Keeper: 6XzCECNR9AHP4VmEKrasgcowcANVFD6WTm5vjdESrpQa (7.9354 SOL at the start, 6.6537 SOL now)
- Wallet A (creator, trader, 1d staker): 8R3JRLeSt15y58NmEjkqFdJURb29CMAxJcTUmQSpnrNW
- Wallet B (7d staker, exits early): 2MYQ5WAqR1fL8hNJSHY3WqNbAB68ee31fXPguw9xi3Ma
- Launch: DCAT `8LxFSM32HDy4KowsAQhRHvz73NETcEh4VafdtoR2x6fB`, curve `56EDiizzVRduUkm9fG3Bth3UeLG1ibqSH1wratHK2FJh`

## Steps

| Step | Result | Wallet txs | Keeper txs | Fees (SOL) |
|---|---|---|---|---|
| fund wallets | wallet A 8R3JRLeSt15y58NmEjkqFdJURb29CMAxJcTUmQSpnrNW 3.5628 SOL, wallet B 2MYQ5WAqR1fL8hNJSHY3WqNbAB68ee31fXPguw9xi3Ma 0.2000 SOL | 2 | 0 | 0.0000 |
| settings | saved default settings with a 5% slippage cap | 0 | 0 | 0.0000 |
| launch | DCAT 8LxFSM32HDy4KowsAQhRHvz73NETcEh4VafdtoR2x6fB on pool 56EDiizzVRduUkm9fG3Bth3UeLG1ibqSH1wratHK2FJh, 3% fee, basket dZEC 50% dJUP 30% dBONK 20% | 1 | 0 | 0.0000 |
| trade until staking opens | staking opened after 20 round trips of up to 0.5 SOL | 40 | 25 | 0.0000 |
| keeper pass after staking opens | confirmed so far: claim 4, split 4, rent 1, swap 3, fund 0, payout 6; 0 errors this pass | 0 | 0 | 0.0000 |
| stake from both wallets | wallet A staked 72337437764551 base units in 1d; wallet B staked 63149226444408 base units in 7d | 3 | 0 | 0.0000 |
| exit early from wallet B | wallet B left the 7d tier with 63149226444408 base units staked; 44210773433731 came back | 1 | 0 | 0.0000 |
| keeper burns the penalty | burned 18938453010677 base units of DCAT https://explorer.solana.com/tx/49hztULDLcNQbckR7PRgRuS1mHwVzqpxDKPVQVpuJqrSorsBKpQpctww5HewYQEnC6tm7QSJic97ZKo999V1G7BU?cluster=devnet | 0 | 10 | 0.0000 |
| payout to creator | paid the creator https://explorer.solana.com/tx/2tUsBgnd9SUFHQpxDpYwth25DmKKbbVsCPtRwvmnMV1QL1ZT5dbPRiYrQqSoUKcdGqX2jAcWEmi9SFAf2wTpXBN5?cluster=devnet | 0 | 0 | 0.0000 |
| trade until graduation | curve raised 2.0000 SOL of 2.0000 | 1 | 0 | 0.0000 |
| migration to DAMM v2 | graduated to DAMM v2 pool BpGBwu11NUvKtt78qrWj62LCLdAPFLEccLeTxLFn78vi, migrated by the keeper https://explorer.solana.com/tx/2H2oByvp22TiFopoBrti8YPxoADJCqsHMKCXv9z2RPz1AxGQMWWzqCrewEfHLceRCAhdEzHq8Eyxrss7DThy1ErS?cluster=devnet | 0 | 10 | 0.0000 |
| trade on DAMM v2 and keeper pass after graduation | sold 332256631081433 base units on DAMM v2; keeper pass: claim confirmed, split confirmed, payout confirmed, swap confirmed, swap confirmed, swap confirmed, fund confirmed, fund confirmed, fund confirmed | 1 | 8 | 0.0000 |
| return wallet SOL to the keeper | wallet A returned 2.2603 SOL; wallet B returned 0.1432 SOL | 2 | 0 | 0.0000 |

## Keeper passes

- 2026-10-02T09:01:07.811Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x1
- 2026-10-02T09:02:25.393Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x2
- 2026-10-02T09:03:25.949Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x1
- 2026-10-02T09:05:32.496Z (trade until staking opens): claim confirmed x1, split confirmed x1, payout confirmed x2, rent confirmed x1, create_farm confirmed x4, configure_farm confirmed x8, swap confirmed x3
- 2026-10-02T09:05:35.110Z (keeper pass after staking opens): no steps
- 2026-10-02T09:06:41.016Z (keeper burns the penalty): claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x3, collect_penalty confirmed x1, burn confirmed x1
- 2026-10-02T09:07:21.610Z (migration to DAMM v2): migrate confirmed x1, claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x3
- 2026-10-02T09:07:42.659Z (migration to DAMM v2): claim confirmed x1
- 2026-10-02T09:08:40.727Z (trade on DAMM v2 and keeper pass after graduation): claim confirmed x1, split confirmed x1, payout confirmed x1, swap confirmed x3, fund confirmed x3

## Different from localnet

- Swaps go through DAMM v2 pools of stand-in tokens (dZEC, dJUP, dBONK, dWIF, dCATE, QUANTS) against SOL, with real on-chain swaps and a minimum out, instead of Jupiter (mainnet) or minting the output (localnet).
- SOL and devnet USDC are priced from mainnet Jupiter prices; stand-ins and QUANTS from their pool price times SOL.
- Graduation targets are low (2 SOL, 300 USDC) so one run can fill a curve.
- Token to token swaps have no route, so a QUANTS or USDC launch only buys rewards with the SOL left after its rent swap, and a USDC launch cannot open staking (there is no USDC pool).
- The keeper's slippage cap is 5% (mainnet default 1%): the stand-in pools hold about 0.3 SOL a side, so a keeper swap of 0.01 SOL already moves the price about 3%.
- Launch metadata was not uploaded (Error: Image uploads are not configured. Set CLOUDINARY_URL.); the launch uses a placeholder URI.

## Transactions

- fund wallets, keeper: [24g9iP5XSg8oMuRb...](https://explorer.solana.com/tx/24g9iP5XSg8oMuRbWfvxER4khV2E8ea95521KHTr6bqciaUFcTvMnjxqwv3aha65DMW26Lb3bRac4SKQ6CCj6pJ5?cluster=devnet)
- fund wallets, keeper: [3HAjvhcUKgBAkdnL...](https://explorer.solana.com/tx/3HAjvhcUKgBAkdnLd49qmiFjg3J3PPW1d8SkAtzXjKViBHf7vAZ9TmLqUVL6FsYyGcDGQ636cZPDhAXT2wC395dH?cluster=devnet)
- launch, wallet A: [jahut4fgL6syT8Gu...](https://explorer.solana.com/tx/jahut4fgL6syT8Gu5gnuQbM7qHyJJ2QPLS4SLz7XGvR6387osE549Vu4ULHkumzRsKrtD7aprXT1GuhDTsjkws4?cluster=devnet)
- trade until staking opens, wallet A: [2ctwE3s8HxkCGb4C...](https://explorer.solana.com/tx/2ctwE3s8HxkCGb4C6vwr1Uvv9k4N25UhQzP3DTbz3zUskDruGFhhJhnUxim5s6JL9g94w4b7ci91HdKW1W4vqSCJ?cluster=devnet)
- trade until staking opens, wallet A: [5PATytGf8v9szzVT...](https://explorer.solana.com/tx/5PATytGf8v9szzVTKCgbkTrg4Go4YU53r6fHdsBVWtUCfu5pYPHoztFPtXoSxkwWDAaRQ5RAeP8AXwbwYKRvvhfq?cluster=devnet)
- trade until staking opens, wallet A: [48bHytjY4qxssW6H...](https://explorer.solana.com/tx/48bHytjY4qxssW6HzDJzQFVGdLivaMFsw3Zz9N6Z3zfFUFchJZ2fXiPGy2Br2Ka8xffLVGQKjzAoo6ynKee9KBks?cluster=devnet)
- trade until staking opens, wallet A: [2hnsrNW4xnKezYMr...](https://explorer.solana.com/tx/2hnsrNW4xnKezYMrcFE1AtmQDpB7GNdWRejGgGQvr9FgP6KYyRRV6gmidfSeUUzaXCRwQKBbWdFgxdFXmQwecspC?cluster=devnet)
- trade until staking opens, wallet A: [2CsCAN7iioBmfpRt...](https://explorer.solana.com/tx/2CsCAN7iioBmfpRtAyLKBApditoTNHLEgL3AY16nGRMnjRjaSNqwFfrKjdHwKSsyyay9EiC3B95VufMdZXD8GuuZ?cluster=devnet)
- trade until staking opens, wallet A: [5N5h6DXyBDYPchva...](https://explorer.solana.com/tx/5N5h6DXyBDYPchva6yyjvceY9HuUY28JCPP9gD9AT2mq5yr72zTx5MKdmy2AA7t2AqHvyrhxtzmCtjAWvs8yJSTP?cluster=devnet)
- trade until staking opens, wallet A: [3ja1KzgLZjoJqarT...](https://explorer.solana.com/tx/3ja1KzgLZjoJqarTbWXefR2bhAvAk4dbEu4nh9KnmvSWDRDivYwCXZmy3tWvAaBGcaDtvNtQAhLd9VUAf58qfbgV?cluster=devnet)
- trade until staking opens, wallet A: [3ceYAtSfsxwX3WM8...](https://explorer.solana.com/tx/3ceYAtSfsxwX3WM8pUi635KLPrxBgAeR9AJ8wtPVyYxbTxkoGeG11L7iJ6PYBPQdZ5jChpXfkJdiD8972iydKTxX?cluster=devnet)
- trade until staking opens, wallet A: [2MHbkhey2fL5MGoE...](https://explorer.solana.com/tx/2MHbkhey2fL5MGoEVSnZirCZn8YWcaQGqgK8YrN5c4R5ZM6AUrzvM6K3akzj3xNqbbm6gLbTuRCSVFZDUwP48BtC?cluster=devnet)
- trade until staking opens, wallet A: [62HwaVxkAmTfYqq6...](https://explorer.solana.com/tx/62HwaVxkAmTfYqq6HbhxbShMDssEwsFqcBCBcECXmSKT5eTtKquw6sUgvsYSR3N3pA6WJh1SRL2rK36KSsqE9ZeF?cluster=devnet)
- trade until staking opens, wallet A: [3uzTNvcQdwGZSgmF...](https://explorer.solana.com/tx/3uzTNvcQdwGZSgmF5rFcJ7XuBCufJuG1MsHRZHLbdBq83nhVwHvPjUuSAkZKC2u9cw9bb4JLXfEUzAu98aeKHKgn?cluster=devnet)
- trade until staking opens, wallet A: [55T48XXsjLAb8Y1o...](https://explorer.solana.com/tx/55T48XXsjLAb8Y1oxyhaY4xy2GbqrqzDwf6SRZtdkWcrFGbjUvotjEKT8iNV5txJC6sefEERXoJcrSpNdw8RgRPq?cluster=devnet)
- trade until staking opens, wallet A: [EEZFVWF9C9ejzkLr...](https://explorer.solana.com/tx/EEZFVWF9C9ejzkLrFJPSfCskHquGZt9hVMrUgQfSFw5JQHkKYmhrcKTuDEF55igCqA41RmzpnNoc9NAxm94xjSi?cluster=devnet)
- trade until staking opens, wallet A: [3NHyuJGttyfkDR5m...](https://explorer.solana.com/tx/3NHyuJGttyfkDR5mc7ReuefR6Ltpwuxsma6VhiaUZp3y8be2woNGyQxFiCAU4nXCRMnLBasYUhhgNVNx2mcfs8oA?cluster=devnet)
- trade until staking opens, wallet A: [63mg95Tc5dH1GTWP...](https://explorer.solana.com/tx/63mg95Tc5dH1GTWPXHXppszNYLuEyasXdyaCUqTC5Nu3LswnJ3KqqcQFqPsp3XEkvr2H6mmTfCtQUccjW1BX74Xy?cluster=devnet)
- trade until staking opens, wallet A: [2584wvbhx98vyHNH...](https://explorer.solana.com/tx/2584wvbhx98vyHNHKrJjeyADSXTnf9w2XbYeRPadfgjUhvUDoUUrB9p5Nc7hMa1ZBnrdyreVrP33EayqrPtXetQP?cluster=devnet)
- trade until staking opens, wallet A: [5RMR6UBVrMfpiibv...](https://explorer.solana.com/tx/5RMR6UBVrMfpiibvh1dk1dQfL81GudfJwos42gcissx9jkEhKKYU7Pbb38VLoefurTrY6bpyoennp8oJ2wKw8YJX?cluster=devnet)
- trade until staking opens, wallet A: [4QXZcJLygn5B7Dm6...](https://explorer.solana.com/tx/4QXZcJLygn5B7Dm6vnrkB8wZCSb2CjRrVfW3mgNdYBqufWjBAxAAgxHKbpsJEpXcp4pWmDV4MAFmT2YBSB31bPLF?cluster=devnet)
- trade until staking opens, wallet A: [4JCmZHc9iyeA1xDB...](https://explorer.solana.com/tx/4JCmZHc9iyeA1xDBEbN1BeyQMkCTt9oZ5YSr8qUwXSoyrZfbmpaz6wBs3jsLepcQWM1DYApnhTLoz9ro36K8Kpp1?cluster=devnet)
- trade until staking opens, wallet A: [5tvYjWKXVFaeKYSE...](https://explorer.solana.com/tx/5tvYjWKXVFaeKYSE7UpCGE7WYNj4Gp6T2xu2qu4rP9aeMnZbaD3D8Pis2ttEvL6dwGd6ETsrNYwjvVk2p6ip3ajz?cluster=devnet)
- trade until staking opens, wallet A: [5w182kvKNCp7o3av...](https://explorer.solana.com/tx/5w182kvKNCp7o3avVTA6q9hLrp7BZrUXVVU8wf3iX6LKUFbXbsVyphvk32zD9pE8sEnBcL4jqRPmDsmgJn98CbL8?cluster=devnet)
- trade until staking opens, wallet A: [5T6SyZmSwPimHvwJ...](https://explorer.solana.com/tx/5T6SyZmSwPimHvwJ9uAzSztozpQ5dymgHjPAAntW13LGjhnsQnGs4z2ZgJC5nrWJfSzHpsS1qBupk7KHp35piCtJ?cluster=devnet)
- trade until staking opens, wallet A: [38qMT4W9Cu19P1b6...](https://explorer.solana.com/tx/38qMT4W9Cu19P1b6obknSEW5wtjbxR3NsAjrDKqS5n4hDHCUFi1Y4JwapXCEwQtv3Fii7TpmMzVdLtT4U8LpGS5x?cluster=devnet)
- trade until staking opens, wallet A: [5ArZAhp8ktTYA3vo...](https://explorer.solana.com/tx/5ArZAhp8ktTYA3voJ4aBn9b78FJmRmMdwdMkQnBndSikWoQyn1WgZMPn9QnirK7uTj5WrW9Ub7CXKrzCRqnCykLS?cluster=devnet)
- trade until staking opens, wallet A: [63987uV5xcZxyJQj...](https://explorer.solana.com/tx/63987uV5xcZxyJQjAHH7vYQSX1ygFoq6fTAxkLujauwLPGE6hBrYFau8bQeaN6ofVcK6yMVcE4SYYKU8EsVH3zUV?cluster=devnet)
- trade until staking opens, wallet A: [25kh9N3qucJyaChp...](https://explorer.solana.com/tx/25kh9N3qucJyaChpuRx6N5KMrMpyNLoTTSqsGeq8YVWvEYcpaopqq8RzQ1rNmaweFvYv85D1yPuC5HLxTydYhyBn?cluster=devnet)
- trade until staking opens, wallet A: [4RWz6nrX3uehHZRB...](https://explorer.solana.com/tx/4RWz6nrX3uehHZRB2EPv82YRWZqcXYfPsK5zX1PXriRR5Q8Ex5hN8SBH5aekGo3u2mDF9KZpcKnASJTRD2HU6ixP?cluster=devnet)
- trade until staking opens, wallet A: [mRCQ9RGEdQ4hH7u8...](https://explorer.solana.com/tx/mRCQ9RGEdQ4hH7u8E8foc569xL1vzpR9e4BEyuRHPceNHzoAYMbZPy4hYsGm6FjyBQX85ojqPr91MctzJseiTWS?cluster=devnet)
- trade until staking opens, wallet A: [5qN8aTXTiYrg8Ks3...](https://explorer.solana.com/tx/5qN8aTXTiYrg8Ks3zRjjGy1tAoVFQZjL1LeHF6WXHiu2aC1b5A9kmN98bm8b2sxn9aAv5rrE71m5CpaUcY23xJ1L?cluster=devnet)
- trade until staking opens, wallet A: [3txGrYrZsa7zvQPP...](https://explorer.solana.com/tx/3txGrYrZsa7zvQPPwZDrgy1qu7dXs2yAyYNLwtrXoW1DqkMm8RmvaydcNtTZfbHc56xbEJX5Gki9LebKDtnsK6Lr?cluster=devnet)
- trade until staking opens, wallet A: [5ca6NAyKKe7SUdhX...](https://explorer.solana.com/tx/5ca6NAyKKe7SUdhXiU81Md5LBP8ftBpUx4bdcXH1HVXKkfpETWPLW2ZtnRBCPsfv35VZcA5WMP4VGyu7u8ZgxVUx?cluster=devnet)
- trade until staking opens, wallet A: [61Uqt566rP83MpLY...](https://explorer.solana.com/tx/61Uqt566rP83MpLYk1SdtBCJ5JRzTuwLTdu8f9L8J8Fa2FjnxdgEJn5t6rPdnAG7YDG2BbnP1hfXwoH45hSqPy5h?cluster=devnet)
- trade until staking opens, wallet A: [4w16aorDJrozFr97...](https://explorer.solana.com/tx/4w16aorDJrozFr97zKsjeXTcu723ckQ65Pa7wKiPiytepvBNx6FzKKN6jHfSAZK2pAncMP6m1ZCGzevJ9uLzizmy?cluster=devnet)
- trade until staking opens, wallet A: [5P2Sx2R3G5x57S3F...](https://explorer.solana.com/tx/5P2Sx2R3G5x57S3FAqQFCNPWf8TFMepEZFp1b692HdYQ4eKNU1oKk89WrXV2crTWVFEdEreTzLVMVZebKguxTLae?cluster=devnet)
- trade until staking opens, wallet A: [3kkr8Q1UaweuNYkQ...](https://explorer.solana.com/tx/3kkr8Q1UaweuNYkQSAFnQcRJmych3Gg5CLKZPh5FthGEdQshSt1rRNFEfFpmsPAsohvNVqLiXNvpAiAK9JAyZPRe?cluster=devnet)
- trade until staking opens, wallet A: [5NGJkESfEbrSHkJJ...](https://explorer.solana.com/tx/5NGJkESfEbrSHkJJHLKCfycdojakJ8dC12bwMumHfMGExabuFz2p2JVN76aiLs5zkKYEAzh5R9dqpjGqeqUAdnEt?cluster=devnet)
- trade until staking opens, wallet A: [5WQjTFdLj1fCvoAp...](https://explorer.solana.com/tx/5WQjTFdLj1fCvoApfH27gHnasn8XoG2rmuWDsf1ibPqJxLHi9UkqBBF31ZYe77wAbPisPYjepUrNp6AcvfWWjzix?cluster=devnet)
- trade until staking opens, wallet A: [5ebxvcWDJGbYTTbB...](https://explorer.solana.com/tx/5ebxvcWDJGbYTTbBxPseq8yUhtMzSsdifz2ZhGyZoEyLMHdmkwyyHTC759dmHEeebaKptjmo6pU6ffN4qv2sryVo?cluster=devnet)
- trade until staking opens, wallet A: [2C35XA4tv5zmzLnd...](https://explorer.solana.com/tx/2C35XA4tv5zmzLndJCadgdYaaz4cUKL1DCtbRtiM4NYJ4nNJnNuWawcq44ShLVFQRhk9dXJwxQGq4EJE2cUtJ4Cf?cluster=devnet)
- trade until staking opens, wallet A: [2TV3Mz5kF5unM5Pn...](https://explorer.solana.com/tx/2TV3Mz5kF5unM5PnNUssBNLS2WpSg1Z2WPGgm6uiy5xH2vACFWDBWgxppt6FUUYb1fKExHzwGF8gXAyjkBJr1rBu?cluster=devnet)
- stake from both wallets, wallet A: [5CnyimDHy4Frkfwb...](https://explorer.solana.com/tx/5CnyimDHy4Frkfwb6UXtAmRie9h7ptnvzqvu89R8hnxAVNW7HCgsZtmgHohNaJf4MZLGLsEnoYBDk2eREJ31xSNp?cluster=devnet)
- stake from both wallets, wallet B: [2iUtHip7D1zHzJQd...](https://explorer.solana.com/tx/2iUtHip7D1zHzJQdHSyc72urJZqCgL35oDSAegviA9sZtW2No2Yyjgt3M6jTbDi1ojAYAmwySKxYihcauZdZsPxi?cluster=devnet)
- stake from both wallets, wallet B: [Nxnw6yR6CGEHHAL7...](https://explorer.solana.com/tx/Nxnw6yR6CGEHHAL7EivHPux5FUxF9WqjbF1KxyCHUNYXeNhbDp7k2nyjhY6aEA6WPRXKv5NUBsL3Lr5oJeT5zBb?cluster=devnet)
- exit early from wallet B, wallet B: [5MwAatPKEhfgvJce...](https://explorer.solana.com/tx/5MwAatPKEhfgvJce571YkEn17bCghzQhZpDvwVjMM6R866FEdTAmDJRd4vi1WcU462PdYuTtiTyzwM3DJpARZrSQ?cluster=devnet)
- trade until graduation, wallet A: [63AVQ5mhCuFUDk28...](https://explorer.solana.com/tx/63AVQ5mhCuFUDk28qY7x4uvgoz1YGaVQqz8KzRLHkhig2KFSasF6no21f894Y9cyjKgpJppbnkhu2CQfv92dKLvn?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, wallet A: [Y4kWfsffJ6BvULHC...](https://explorer.solana.com/tx/Y4kWfsffJ6BvULHCLnNiSGAUfzysL5Fc3L3dL2ngzzKwNHYZKWrqvDZ1EAEVTr6nYyTT7abTkbgXuzNdxqEDr46?cluster=devnet)
- return wallet SOL to the keeper, wallet A: [2NVA2GZVwwZdUe91...](https://explorer.solana.com/tx/2NVA2GZVwwZdUe91WkGY1JXdHnbHM63ajqMStwwuVCDVzVPPSdJKn75bpPA9s3gnXiG7ATm9sWXWxuMrzadDTyTn?cluster=devnet)
- return wallet SOL to the keeper, wallet B: [ZfigheahZx7wNWcp...](https://explorer.solana.com/tx/ZfigheahZx7wNWcpVr1rgKdvj6rwGgyDTHkCmLGCwKKSwPLHHP9pG43xtccJKvY8THrqZMtgYYeHkWsvNAbpfDX?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [3R8UaFUSP217QsZJ...](https://explorer.solana.com/tx/3R8UaFUSP217QsZJeJrAbYGs26zMe5s1fqt13dYtaMj2g8iWRJuqChJry9Wv3Kr7r9rYr4qWJMcq8aTU2aWrhmS6?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [2tUsBgnd9SUFHQpx...](https://explorer.solana.com/tx/2tUsBgnd9SUFHQpxDpYwth25DmKKbbVsCPtRwvmnMV1QL1ZT5dbPRiYrQqSoUKcdGqX2jAcWEmi9SFAf2wTpXBN5?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [356ewn5nDTszK6h5...](https://explorer.solana.com/tx/356ewn5nDTszK6h5mSNFMLdwZCy8DWZewisWNvoomNuXmsGEkBd8a1a4R8N48xfZWbkmWUjgSLpY3YPgUnd89egF?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [4zhQy4rPaY3kx8N1...](https://explorer.solana.com/tx/4zhQy4rPaY3kx8N1G8eUmpjM7V15r96VfYJziVVdUVckCEfAx3MsqbWR5yGpt41SirsfJtdCt8keyV7y91A3ekwu?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [4jZtTXZtsy3Bx4dj...](https://explorer.solana.com/tx/4jZtTXZtsy3Bx4djgtBL8obmUFEMQEBbhMsXmUnL1zg7ZMk58ejp4huXGWc3xA67cMGjKp87VK4wgRDevXVTFzfL?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [49bgDfttbBFrgSU7...](https://explorer.solana.com/tx/49bgDfttbBFrgSU7kntDqRMHEwW8LmB8gGaFkQvL1zE9AMgbs9tMog8tdZKqbTuKMvnLyD2fV9kYLLb7w8x2ZE5S?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [62JzCMiMG9D4Z4AT...](https://explorer.solana.com/tx/62JzCMiMG9D4Z4ATYbZZnfESCWXyday7J246T8N264b5CMLdCPzattK5VxXzjzjWs1gJ8NgvU5QtjHFXAntAbpT1?cluster=devnet)
- trade until staking opens, keeper claim confirmed: [3oh1r8CDhWq9Qa31...](https://explorer.solana.com/tx/3oh1r8CDhWq9Qa31VNXGmiXsDQYLg4WuuXc43fpDbfUFt4Tz35foSddidsvWqp3oCmDn3NxAQVv68TJUVA5e9XLs?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [dCCYDUzNu1KsXLsw...](https://explorer.solana.com/tx/dCCYDUzNu1KsXLswXMQ2pg4DKvyfxrzCvjkXhxhfgLQ8mzwUhFqiDy9NfdwP681SnqW9gjT1nVeMLzjrbo68m8Z?cluster=devnet)
- trade until staking opens, keeper payout confirmed: [41Asx2naqMXS6CLf...](https://explorer.solana.com/tx/41Asx2naqMXS6CLfihRgpDBmobRpAix8fyRffQMVHMXc7pxLb34YdkgEWoE4Kx7mx2asNBRP1htC4S2uwd7FpqFf?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [xkLVsQuyqwCjNz7c...](https://explorer.solana.com/tx/xkLVsQuyqwCjNz7cWngURK2My9qewFAygRccz9ax3UhsPSTHnHC3WUUcfSAZ5WPqKHXteLE8D6rffNTBz44aH6s?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [5Yvdez2iRYBwojf8...](https://explorer.solana.com/tx/5Yvdez2iRYBwojf8prGFaq7rtMizucpo8tcxvhQ359fh1gfBiXZjjyXoVwFWCqrY2BxSiESiSKqPfw2H2vARNrzP?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [3ShfA8oqQFKvGV1K...](https://explorer.solana.com/tx/3ShfA8oqQFKvGV1K5wvcHxxKPHqv4uc86Qb4ymH5rDVKj4zcK9XbmDUh3t51NueUhWrdazjqVM82zu5fqxHjqZ8E?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [4Tok8gV6KjsR5KfG...](https://explorer.solana.com/tx/4Tok8gV6KjsR5KfGsagbe4k6pt8vycvmBARqoCfTqT2g7zQ7zp38g8nfP3HjfnQsXgHCHQeud1zXqmxx2ninHsrr?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2ZPGgTtq8Widen8v...](https://explorer.solana.com/tx/2ZPGgTtq8Widen8vQNga6qu2AwnmprvFJMQXzXnC9nZD59DXRx6Nqf3zSxoMMQSdvEr7TAuJEjytmGp9p1QYhmX4?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [251aWYW1N2bc2QtW...](https://explorer.solana.com/tx/251aWYW1N2bc2QtWSEAvrt4Q1rpbJnahakvTeCaJwAcrGEU92E9QusKaTR6MjFtu1bmXrCuM6gysAfiX3pPdijqT?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [499KBeWCAm2cvrHa...](https://explorer.solana.com/tx/499KBeWCAm2cvrHaMSgGEptCcUbSxW6m5Fady9dTLe9tXMJbLNwDWjtdj4M53XR6YSyVNHfYcnKu82gbffvWjR3p?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2rpTPD6my8YyNvwW...](https://explorer.solana.com/tx/2rpTPD6my8YyNvwWpvKgD8PNNDTe6oxf2hsvjeN8AYTh5LTGLtdLVrhZ1zUxQUUR7bCVETkqw8dRoAtTf9VKx4Fx?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [4qHjPqamwXoCHicY...](https://explorer.solana.com/tx/4qHjPqamwXoCHicYaqg2HaUQB6oBGDtf5aYySVfUAqQT6k9no8srXSokhhraLd54paS13qFcLNmRzJPJWXcJamtk?cluster=devnet)
- trade until staking opens, keeper create_farm confirmed: [3mhCuuroM3AHZyuj...](https://explorer.solana.com/tx/3mhCuuroM3AHZyujCkFgzDpUPs3suCcqvcZ8c9B74d78tCWnaqANw9wi28ARqgv8hAEQTRfvKyXkB5724uWwAHiJ?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [4X4Fj81gVB1UiKPq...](https://explorer.solana.com/tx/4X4Fj81gVB1UiKPqddJL5MY9LiWViPShmG7bVVzf3bt6M4oUHrkLc2TDeJ2Eubh8ky3vRCffz59u9iEQLqNPxqaq?cluster=devnet)
- trade until staking opens, keeper configure_farm confirmed: [2udzK4g5j6s5Lb4r...](https://explorer.solana.com/tx/2udzK4g5j6s5Lb4rwd8S1sCLu6x3dJyDS5pwWAWtfvToL8oYeB4UteLDA6arQP1ib8fvAEsNjyNKcZUxWNkFYWt8?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [27GPUqxDG1xr7gs6...](https://explorer.solana.com/tx/27GPUqxDG1xr7gs6XhszDoaTj4iwokzimjdDXVPJL3gyDjn8MmZyqrRtAHCf9vjJSSxd9gdVKgaQLEqFKxEvwXYh?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [5pBc12uQWBLM8u6U...](https://explorer.solana.com/tx/5pBc12uQWBLM8u6UgPfpcpLorLL6sdXG52PJgd5PkDwFhKMhmT6D6SQxNJYLjrFkZw8j6mcgzjFC8C94YZD7utVA?cluster=devnet)
- trade until staking opens, keeper swap confirmed: [5QgnZCXCgHXDH8Qz...](https://explorer.solana.com/tx/5QgnZCXCgHXDH8QzAoddWSeZgtjPorhuzJfJrxTJW9qdy451kxj8qiKiSePr5FrUGseTcBHpqdej95TLbtJZEEfq?cluster=devnet)
- keeper burns the penalty, keeper claim confirmed: [4wRb3MBYj7Ryyqfd...](https://explorer.solana.com/tx/4wRb3MBYj7RyyqfdXyD75kWkgyV9yxK9roVtxmdqHg1PVTUeq1YECvaFoMCeHZkr1oo5Xg7tuPCRo2P22LngGJRB?cluster=devnet)
- keeper burns the penalty, keeper payout confirmed: [HpcUEiHycGskwkEk...](https://explorer.solana.com/tx/HpcUEiHycGskwkEkM15mtdtBez7SCvmF49k8hGvGFqun6gVRkTrLX4imX9hUwS9dZjHTtB6jSrxZoVCTuxmFTcU?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [3fC54LixAcqzQuVx...](https://explorer.solana.com/tx/3fC54LixAcqzQuVxqM28geAekez1vKDsmg7WzVrV56Y3onKijvajwy5zL5K575HrJGawrQKjvykJd3fisgrzcESa?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [3HrYZsJfckz1CBEZ...](https://explorer.solana.com/tx/3HrYZsJfckz1CBEZ2YCXsqCex9GWuzYzFrwv1VTwJugVFZBrjs2ZcFGAEN8tRszV8whoH1Ch2a5VSsiXR3dZosba?cluster=devnet)
- keeper burns the penalty, keeper swap confirmed: [2Ah8XzruW9si4bNv...](https://explorer.solana.com/tx/2Ah8XzruW9si4bNvrofYUGsyvK9vQDDPFBCJTmFvw557BSLF9TGNrtFPC1aqpLcrsYHEG8ZtVK1Z8Ec16NYq99xJ?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [rdqAY3tk6trfLxMK...](https://explorer.solana.com/tx/rdqAY3tk6trfLxMKLVkKZeUiHdJjhuYotmk5jZybEXCLQ3z2obYyyBmaPBLDD1qdKTFNFBSnj1uDEHsjZrknLgh?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [3kbVmuGJQsoZTe8p...](https://explorer.solana.com/tx/3kbVmuGJQsoZTe8pYjkv3WvuibzJWUXCUPwcuw5oviV2cs4GHH6dHhLjkoYwTsbqqe66a19r1bCYSNXLL2L5c9M5?cluster=devnet)
- keeper burns the penalty, keeper fund confirmed: [Wv8ZssGSdwoKepBG...](https://explorer.solana.com/tx/Wv8ZssGSdwoKepBGo3Jd5rwj1pBLDRT8XJDhMPCK3NknMdsqWBRKoiqfYkAzvbaiM1rQG8d5SFNnxN3zbA4s4Nw?cluster=devnet)
- keeper burns the penalty, keeper collect_penalty confirmed: [3axb5Zk6cf9nZMcz...](https://explorer.solana.com/tx/3axb5Zk6cf9nZMczNN7DDhsp974Hq4HpA4Hzuh2DNEYgTsCDafA1FRemZczMzYWbVcGbmXXVY7f6QQyHPaXYvWfa?cluster=devnet)
- keeper burns the penalty, keeper burn confirmed: [49hztULDLcNQbckR...](https://explorer.solana.com/tx/49hztULDLcNQbckR7PRgRuS1mHwVzqpxDKPVQVpuJqrSorsBKpQpctww5HewYQEnC6tm7QSJic97ZKo999V1G7BU?cluster=devnet)
- migration to DAMM v2, keeper migrate confirmed: [2H2oByvp22TiFopo...](https://explorer.solana.com/tx/2H2oByvp22TiFopoBrti8YPxoADJCqsHMKCXv9z2RPz1AxGQMWWzqCrewEfHLceRCAhdEzHq8Eyxrss7DThy1ErS?cluster=devnet)
- migration to DAMM v2, keeper claim confirmed: [51mqvVfiZpbBzknz...](https://explorer.solana.com/tx/51mqvVfiZpbBzknzwwFVyzUdarw94R82DR9HGzKCvAJ3YpPNozp24m6DZ6AV4NUVZGk82wvLpE8v6wKDgTXWoqaD?cluster=devnet)
- migration to DAMM v2, keeper payout confirmed: [279zChd3MutUHWnT...](https://explorer.solana.com/tx/279zChd3MutUHWnTuLR2LPhJQweAS6J3T34VCbamDmNtcmyNMUeZWVNUK8XGDg9o2P4HsTbXHys8jA4eDQ3R5dJ5?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [288L45JEfAn9cgEA...](https://explorer.solana.com/tx/288L45JEfAn9cgEAK8jBFcnFbb2VKCx8uMDXZ2KBfxMpYXVtPDjNKrnrHrUtauwaH4AMKmSE2fUf43DAq4uhAAjV?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [2UJU4qxRxSX6cZ7V...](https://explorer.solana.com/tx/2UJU4qxRxSX6cZ7Vbdni3HxEaNGCp6Hc635NTNFbAnSGcgZkS7EGx4uAtguXiPhZEJC42MJKmRuNRJf7xWJGwLWJ?cluster=devnet)
- migration to DAMM v2, keeper swap confirmed: [64GPb89uKVzHYv1c...](https://explorer.solana.com/tx/64GPb89uKVzHYv1cH4wfa1haLhcxLfn8ujTgkrm7fVUKaTuRHySdBvfwVdzYgcQkTzmcoCexpJuLYehknEzhRePr?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [4ufRUx9BF9kjdsUD...](https://explorer.solana.com/tx/4ufRUx9BF9kjdsUDtk3gkZCCXZsa4hcs3buJJc76W5jwbB2SYGWGJnxYHbpS1ofveGTXBgnoCmNP7DDKJgyZVGwA?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [3pjvzn2NKE4Tridp...](https://explorer.solana.com/tx/3pjvzn2NKE4TridpLv1U7vamHPVfAPDu43QYX683pnz6BHdtntLDnFe3hz6VgNzKv4279FVTQBkwXJEn5Stn92HS?cluster=devnet)
- migration to DAMM v2, keeper fund confirmed: [3npDfXzpcyqR98XW...](https://explorer.solana.com/tx/3npDfXzpcyqR98XW7DwkZXcBLR3NbS6zdCd1yHQVgRUybwTZBC987xtQPojcrzBchqYHZ1rNcbHidofsESnWT9vY?cluster=devnet)
- migration to DAMM v2, keeper claim confirmed: [3gAGPpzAksuUFYTX...](https://explorer.solana.com/tx/3gAGPpzAksuUFYTXLb6CUtwEFDb3FoHpTy5Sfcd3JDuFVHeJ4omYeJq7ZWf3G3WAEStK8uxfPobXCZXBzQLsG8VT?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper claim confirmed: [5gvH3HKEv6HFL2i8...](https://explorer.solana.com/tx/5gvH3HKEv6HFL2i8uiXYqoMq67snBWGE1TsTea8eUDEgU6wkKPMp2znGSjEKf3QTiAAu9Q4doWgrVBFsBGBTaq3F?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper payout confirmed: [62FkPfm97wgnWqVV...](https://explorer.solana.com/tx/62FkPfm97wgnWqVVVsjutVepAdc1WSyrEJJFwZGVsAzR3Qj3haWtWjnR3utDrmZYuj32aLvQ3VV7nKX4xgFtY89s?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [2ZUfhrfeidHfThnN...](https://explorer.solana.com/tx/2ZUfhrfeidHfThnNTr8WLxT5pmmxYaHSRDiH6sVN4T5r5r5P8G4yDuji27P5bw8ewxsLwMUKv1uxRLMvWFaz6BWL?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [4BjvMrU2tkmf5y5Z...](https://explorer.solana.com/tx/4BjvMrU2tkmf5y5ZhwhHy7foMyURfQA2BBhyCG8yfTWsx5B32vqzE3WbJoRbRj4irybEnkGVDkARBzcgfDJgCmvH?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper swap confirmed: [TsVx7xjJgfiXKWtZ...](https://explorer.solana.com/tx/TsVx7xjJgfiXKWtZv8gH4rzceQt4YJn7ZgmwzxVW9iiuxBncaEhsafojrAs3MQ6mZf3aCU3Y5GK76rbsVdmRt4t?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund confirmed: [5wcfRHcpvpfpDJjK...](https://explorer.solana.com/tx/5wcfRHcpvpfpDJjKeyEwBBp9MVDFQZJpAwYVJHrAUgWa5E3G6FeDEuv1hApsbTCfLyCW6HnHRHeuMazcT9oSi3P9?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund confirmed: [4StMZyzNy9XvtGeE...](https://explorer.solana.com/tx/4StMZyzNy9XvtGeEND3FfFPnpjQdbAn6iq3GeCNQ48pviGKoL181xzbDymxRKTB9CYokokbUjGz448vnaTFpMtER?cluster=devnet)
- trade on DAMM v2 and keeper pass after graduation, keeper fund confirmed: [627Ct5u7uGPc96Ef...](https://explorer.solana.com/tx/627Ct5u7uGPc96EfDS8QQLuE4gu7Zcrzk9NV4C16Rw5LmEJtY3dyUoQUDkyY36LcCHYtbX4dyNnPtmFaKBaorFe6?cluster=devnet)
