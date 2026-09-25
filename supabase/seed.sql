-- Launch asset registry. Mints and Pyth feed ids follow the PRD launch registry. Name, symbol,
-- decimals and token program were read from each mainnet mint account (Token-2022 metadata
-- extension), and schedule from each regular feed's attributes on Pyth Hermes, on 2026-09-25.
-- blocked_countries keeps its empty default: no issuer country list was sourced for this seed.

insert into assets (
  mint, symbol, name, kind, issuer, token_program, decimals,
  feed_id, feed_id_247, schedule, status,
  default_band_bps, max_band_bps, band_247_extra_bps, sort_order
)
values
  (
    'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', 'SPYx', 'SP500 xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5', null,
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 0, 10
  ),
  (
    'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', 'QQQx', 'Nasdaq xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d', null,
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 0, 20
  ),
  (
    'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 'NVDAx', 'NVIDIA xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
    'a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 30
  ),
  (
    'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', 'AAPLx', 'Apple xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    'aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 40
  ),
  (
    'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 'TSLAx', 'Tesla xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
    'e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 50
  ),
  (
    'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', 'MSFTx', 'Microsoft xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    'd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1',
    'd9144b30a3a162a2748d384dc53387571f3ec77b9edfe31739349396ed67a63a',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 60
  ),
  (
    'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 'GOOGLx', 'Alphabet xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6',
    'ad519718d387de4f0d7d29ea16a3730ce42e49c59fef6fba6fc9bac477645f6f',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 70
  ),
  (
    'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', 'AMZNx', 'Amazon.com xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    'b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a',
    '329635cf9e705e01ed2d842fafbb6c426d7e5630e75847740d89957222fd68b8',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 80
  ),
  (
    'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', 'METAx', 'Meta xStock',
    'listed_equity', 'xstocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 8,
    '78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe',
    '2cc0c022f7f37920485a5947f3cea8633783b6cb7fff6d94ee52f48687b7783d',
    'America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C',
    'active', 50, 300, 50, 90
  ),
  (
    'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', 'OPENAI', 'OpenAI PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 100
  ),
  (
    'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw', 'ANTHROPIC', 'Anthropic PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 110
  ),
  (
    'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB', 'ANDURIL', 'Anduril PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 120
  ),
  (
    'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd', 'FIGUREAI', 'Figure AI PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 130
  ),
  (
    'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua', 'KALSHI', 'Kalshi PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 140
  ),
  (
    'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP', 'POLYMARKET', 'Polymarket PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 150
  ),
  (
    'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S', 'NEURALINK', 'Neuralink PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'active', 300, 1000, 0, 160
  ),
  -- Conversion target, ratio and deadline stay null: none of the PRD, the mint account or Pyth publishes them.
  (
    'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', 'SPACEX', 'SpaceX PreStocks',
    'pre_ipo', 'prestocks', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 9,
    null, null, null,
    'converting', 300, 1000, 0, 170
  )
on conflict (mint) do update set
  symbol = excluded.symbol,
  name = excluded.name,
  kind = excluded.kind,
  issuer = excluded.issuer,
  token_program = excluded.token_program,
  decimals = excluded.decimals,
  feed_id = excluded.feed_id,
  feed_id_247 = excluded.feed_id_247,
  schedule = excluded.schedule,
  status = excluded.status,
  default_band_bps = excluded.default_band_bps,
  max_band_bps = excluded.max_band_bps,
  band_247_extra_bps = excluded.band_247_extra_bps,
  conversion_target = excluded.conversion_target,
  conversion_ratio_num = excluded.conversion_ratio_num,
  conversion_ratio_den = excluded.conversion_ratio_den,
  conversion_deadline = excluded.conversion_deadline,
  blocked_countries = excluded.blocked_countries,
  sort_order = excluded.sort_order;
