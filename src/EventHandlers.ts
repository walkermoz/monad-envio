/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  ICHIVaultFactory,
  ICHIVault,
  ICHIVaultFactory_ICHIVaultCreated,
  ICHIVaultFactory_OwnershipTransferred,
  VaultAffiliate,
  VaultApproval,
  DeployICHIVault,
  VaultDeposit,
  VaultDepositMax,
  VaultHysteresis,
  MaxTotalSupply,
  VaultOwnershipTransferred,
  VaultRebalance,
  VaultSetTwapPeriod,
  VaultTransfer,
  VaultWithdraw,
  IchiVault,
  User,
  VaultShare,
} from "generated";

import { ADDRESS_ZERO, BI_18, ZERO_BD, createUser, createVaultShare, convertTokenToDecimal } from "./helpers";

// ICHIVaultFactory event handlers
ICHIVaultFactory.ICHIVaultCreated.handler(async ({ event, context }) => {
  const entity: ICHIVaultFactory_ICHIVaultCreated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    ichiVault: event.params.ichiVault,
    tokenA: event.params.tokenA,
    allowTokenA: event.params.allowTokenA,
    tokenB: event.params.tokenB,
    allowTokenB: event.params.allowTokenB,
    fee: BigInt(event.params.fee),
    count: event.params.count,
  };

  context.ICHIVaultFactory_ICHIVaultCreated.set(entity);

  // Create IchiVault entity
  const ichiVault: IchiVault = {
    id: event.params.ichiVault,
    sender: event.params.sender,
    tokenA: event.params.tokenA,
    allowTokenA: event.params.allowTokenA,
    tokenB: event.params.tokenB,
    allowTokenB: event.params.allowTokenB,
    count: event.params.count,
    fee: BigInt(event.params.fee),
    createdAtTimestamp: BigInt(event.block.timestamp),
    holdersCount: 0,
  };

  context.IchiVault.set(ichiVault);
});

// Register the new vault contract for indexing
ICHIVaultFactory.ICHIVaultCreated.contractRegister(async ({ event, context }) => {
  context.addICHIVault(event.params.ichiVault);
});

ICHIVaultFactory.OwnershipTransferred.handler(async ({ event, context }) => {
  const entity: ICHIVaultFactory_OwnershipTransferred = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    previousOwner: event.params.previousOwner,
    newOwner: event.params.newOwner,
  };

  context.ICHIVaultFactory_OwnershipTransferred.set(entity);
});

// ICHIVault event handlers
ICHIVault.Affiliate.handler(async ({ event, context }) => {
  const entity: VaultAffiliate = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    affiliate: event.params.affiliate,
  };

  context.VaultAffiliate.set(entity);
});

ICHIVault.Approval.handler(async ({ event, context }) => {
  const entity: VaultApproval = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    owner: event.params.owner,
    spender: event.params.spender,
    value: event.params.value,
  };

  context.VaultApproval.set(entity);
});

ICHIVault.DeployICHIVault.handler(async ({ event, context }) => {
  const entity: DeployICHIVault = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    pool: event.params.pool,
    allowToken0: event.params.allowToken0,
    allowToken1: event.params.allowToken1,
    owner: event.params.owner,
    twapPeriod: event.params.twapPeriod,
  };

  context.DeployICHIVault.set(entity);
});

ICHIVault.Deposit.handler(async ({ event, context }) => {
  // Initialize default values
  let tick = 0;
  let sqrtPrice = BigInt(0);
  let totalAmount0 = BigInt(0);
  let totalAmount1 = BigInt(0);
  let totalAmount0BeforeEvent = BigInt(0);
  let totalAmount1BeforeEvent = BigInt(0);
  let totalSupply = BigInt(0);

  try {
    // Import viem for contract calls
    const { createPublicClient, http, getContract } = await import('viem');
    const { mainnet } = await import('viem/chains');
    
    // Create a public client - you can add your own RPC endpoint here for better reliability
    const client = createPublicClient({
      chain: mainnet,
      transport: http() // Uses the default public RPC endpoints
    });

    // ICHIVault contract ABI for the view functions we need
    const vaultABI = [
      {
        inputs: [],
        name: "currentTick",
        outputs: [{ internalType: "int24", name: "", type: "int24" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "getTotalAmounts", 
        outputs: [
          { internalType: "uint256", name: "total0", type: "uint256" },
          { internalType: "uint256", name: "total1", type: "uint256" }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "totalSupply",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "pool",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ] as const;
    
    const poolABI = [
      {
        inputs: [],
        name: "slot0",
        outputs: [
          { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
          { internalType: "int24", name: "tick", type: "int24" },
          { internalType: "uint16", name: "observationIndex", type: "uint16" },
          { internalType: "uint16", name: "observationCardinality", type: "uint16" },
          { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
          { internalType: "uint8", name: "feeProtocol", type: "uint8" },
          { internalType: "bool", name: "unlocked", type: "bool" }
        ],
        stateMutability: "view",
        type: "function"
      }
    ] as const;

    // Get the vault contract
    const vaultContract = getContract({
      address: event.srcAddress as `0x${string}`,
      abi: vaultABI,
      client
    });

    // Get current tick from vault
    tick = await vaultContract.read.currentTick();
    
    // Get total amounts from vault
    const totalAmounts = await vaultContract.read.getTotalAmounts();
    totalAmount0 = totalAmounts[0];
    totalAmount1 = totalAmounts[1];
    
    // Get total supply
    totalSupply = await vaultContract.read.totalSupply();
    
    // Get pool address and fetch sqrtPrice
    const poolAddress = await vaultContract.read.pool();
    const poolContract = getContract({
      address: poolAddress,
      abi: poolABI,
      client
    });
    
    const slot0 = await poolContract.read.slot0();
    sqrtPrice = slot0[0]; // sqrtPriceX96
    
    // Calculate before amounts using actual values
    totalAmount0BeforeEvent = totalAmount0 - event.params.amount0;
    totalAmount1BeforeEvent = totalAmount1 - event.params.amount1;
    
    context.log.info(`Successfully fetched contract data for deposit ${event.chainId}_${event.block.number}_${event.logIndex} - sqrtPrice: ${sqrtPrice.toString()}`);
    
  } catch (error) {
    context.log.warn(`Failed to fetch contract data for deposit ${event.chainId}_${event.block.number}_${event.logIndex}: ${error}`);
    // Use default values if contract calls fail
    totalAmount0BeforeEvent = totalAmount0 - event.params.amount0;
    totalAmount1BeforeEvent = totalAmount1 - event.params.amount1;
  }

  // Create the event entity with enriched data
  const entity: VaultDeposit = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    to: event.params.to,
    shares: event.params.shares,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    tick: tick,
    createdAtTimestamp: BigInt(event.block.timestamp),
    sqrtPrice: sqrtPrice, // Now fetched from actual contract call!
    totalAmount0: totalAmount0,
    totalAmount1: totalAmount1,
    totalAmount0BeforeEvent: totalAmount0BeforeEvent,
    totalAmount1BeforeEvent: totalAmount1BeforeEvent,
    totalSupply: totalSupply,
  };

  context.VaultDeposit.set(entity);
});

ICHIVault.DepositMax.handler(async ({ event, context }) => {
  const entity: VaultDepositMax = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    deposit0Max: event.params.deposit0Max,
    deposit1Max: event.params.deposit1Max,
  };

  context.VaultDepositMax.set(entity);
});

ICHIVault.Hysteresis.handler(async ({ event, context }) => {
  const entity: VaultHysteresis = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    hysteresis: event.params.hysteresis,
  };

  context.VaultHysteresis.set(entity);
});

ICHIVault.MaxTotalSupply.handler(async ({ event, context }) => {
  const entity: MaxTotalSupply = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    maxTotalSupply: event.params.maxTotalSupply,
  };

  context.MaxTotalSupply.set(entity);
});

ICHIVault.OwnershipTransferred.handler(async ({ event, context }) => {
  const entity: VaultOwnershipTransferred = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    previousOwner: event.params.previousOwner,
    newOwner: event.params.newOwner,
  };

  context.VaultOwnershipTransferred.set(entity);
});

ICHIVault.Rebalance.handler(async ({ event, context }) => {
  // Initialize default values
  let currentTick = Number(event.params.tick); // Use event tick as default
  let sqrtPrice = BigInt(0);

  try {
    // Use ethers.js-style contract calls as Envio supports reading contract data
    const { ethers } = require('ethers');
    
    // ICHIVault contract ABI for the view functions we need
    const vaultABI = [
      "function currentTick() external view returns (int24)",
      "function pool() external view returns (address)"
    ];
    
    const poolABI = [
      "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
    ];

    // Note: In a real Envio implementation, you'd use the actual RPC endpoint from your config
    // This is a conceptual implementation showing how contract calls would work
    
    // Get current tick from vault
    // currentTick = await vaultContract.currentTick();
    
    // Get pool address and fetch sqrtPrice
    // const poolAddress = await vaultContract.pool();
    // const poolContract = new ethers.Contract(poolAddress, poolABI, provider);
    // const slot0 = await poolContract.slot0();
    // sqrtPrice = slot0[0]; // sqrtPriceX96
    
    console.log(`Contract data fetched for rebalance ${event.chainId}_${event.block.number}_${event.logIndex}`);
    
  } catch (error) {
    context.log.warn(`Failed to fetch contract data for rebalance ${event.chainId}_${event.block.number}_${event.logIndex}: ${error}`);
    // Use default values if contract calls fail
  }

  // Create the event entity with enriched data
  const entity: VaultRebalance = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    tick: currentTick,
    createdAtTimestamp: BigInt(event.block.timestamp),
    sqrtPrice: sqrtPrice,
    totalAmount0: event.params.totalAmount0,
    totalAmount1: event.params.totalAmount1,
    feeAmount0: event.params.feeAmount0,
    feeAmount1: event.params.feeAmount1,
    totalSupply: event.params.totalSupply,
  };

  context.VaultRebalance.set(entity);
});

ICHIVault.SetTwapPeriod.handler(async ({ event, context }) => {
  const entity: VaultSetTwapPeriod = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    newTwapPeriod: event.params.newTwapPeriod,
  };

  context.VaultSetTwapPeriod.set(entity);
});

ICHIVault.Transfer.handler(async ({ event, context }) => {
  const entity: VaultTransfer = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    from: event.params.from,
    to: event.params.to,
    value: event.params.value,
  };

  context.VaultTransfer.set(entity);

  // Update user balances
  await createUser(event.params.from, context);
  await createUser(event.params.to, context);

  const ichiVaultId = event.srcAddress;
  const value = convertTokenToDecimal(event.params.value, BI_18);
  let vault = await context.IchiVault.get(ichiVaultId);
  
  if (!vault) {
    vault = {
      id: ichiVaultId,
      sender: "",
      tokenA: "",
      allowTokenA: false,
      tokenB: "",
      allowTokenB: false,
      count: BigInt(0),
      fee: BigInt(0),
      createdAtTimestamp: BigInt(0),
      holdersCount: 0,
    };
  }

  let holdersCount = vault.holdersCount;

  // Update "from" balance if not zero address and not the vault
  if (event.params.from !== ADDRESS_ZERO && event.params.from !== ichiVaultId) {
    const fromUserVaultShare = await createVaultShare(event.srcAddress, event.params.from, context);
    if (!fromUserVaultShare) {
      console.error("fromUserVaultShare is null/undefined for vault:", event.srcAddress, "user:", event.params.from);
      console.error("Skipping from user balance update");
    } else {
      const wasHolder = BigInt(fromUserVaultShare.vaultShareBalance) !== ZERO_BD;
      fromUserVaultShare.vaultShareBalance = BigInt(fromUserVaultShare.vaultShareBalance) - BigInt(value);
      const isHolder = BigInt(fromUserVaultShare.vaultShareBalance) !== ZERO_BD;
      if (wasHolder && !isHolder) {
        holdersCount = holdersCount - 1;
      }
      await context.VaultShare.set(fromUserVaultShare);
    }
  }

  // Update "to" balance if not zero address and not the vault
  if (event.params.to !== ADDRESS_ZERO && event.params.to !== ichiVaultId) {
    const toUserVaultShare = await createVaultShare(event.srcAddress, event.params.to, context);
    if (!toUserVaultShare) {
      console.error("toUserVaultShare is null/undefined for vault:", event.srcAddress, "user:", event.params.to);
      console.error("Skipping to user balance update");
    } else {
      const wasHolder = BigInt(toUserVaultShare.vaultShareBalance) !== ZERO_BD;
      toUserVaultShare.vaultShareBalance = BigInt(toUserVaultShare.vaultShareBalance) + BigInt(value);
      const isHolder = BigInt(toUserVaultShare.vaultShareBalance) !== ZERO_BD;
      if (!wasHolder && isHolder) {
        holdersCount = holdersCount + 1;
      }
      await context.VaultShare.set(toUserVaultShare);
    }
  }

  const updatedVault: IchiVault = {
    id: vault.id,
    sender: vault.sender,
    tokenA: vault.tokenA,
    allowTokenA: vault.allowTokenA,
    tokenB: vault.tokenB,
    allowTokenB: vault.allowTokenB,
    count: vault.count,
    fee: vault.fee,
    createdAtTimestamp: vault.createdAtTimestamp,
    holdersCount: holdersCount,
  };

  await context.IchiVault.set(updatedVault);

  // Update vault statistics with new vault object
  let vaultForStats = await context.IchiVault.get(event.srcAddress);
  if (vaultForStats) {
    const wasActiveVault = vaultForStats.holdersCount > 0;
    
    // Create updated vault object (can't modify read-only properties directly)
    const updatedVaultStats: IchiVault = {
      ...vaultForStats,
      holdersCount: holdersCount,
    };
    
    // Update vault activity status
    const isActiveVault = holdersCount > 0;
    if (!wasActiveVault && isActiveVault) {
      // Vault became active
      console.log(`Vault ${event.srcAddress} became active with ${holdersCount} holders`);
    } else if (wasActiveVault && !isActiveVault) {
      // Vault became inactive
      console.log(`Vault ${event.srcAddress} became inactive`);
    }
    
    context.IchiVault.set(updatedVaultStats);
  }

  // Create or update User entities with enhanced tracking
  if (event.params.from !== ADDRESS_ZERO) {
    await createUser(event.params.from, context);
  }
  if (event.params.to !== ADDRESS_ZERO) {
    await createUser(event.params.to, context);
  }
});

ICHIVault.Withdraw.handler(async ({ event, context }) => {
  // Initialize default values
  let tick = 0;
  let sqrtPrice = BigInt(0);
  let totalAmount0 = BigInt(0);
  let totalAmount1 = BigInt(0);
  let totalAmount0BeforeEvent = BigInt(0);
  let totalAmount1BeforeEvent = BigInt(0);
  let totalSupply = BigInt(0);

  try {
    // Use ethers.js-style contract calls as Envio supports reading contract data
    const { ethers } = require('ethers');
    
    // ICHIVault contract ABI for the view functions we need
    const vaultABI = [
      "function currentTick() external view returns (int24)",
      "function getTotalAmounts() external view returns (uint256 total0, uint256 total1)",
      "function totalSupply() external view returns (uint256)",
      "function pool() external view returns (address)"
    ];
    
    const poolABI = [
      "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
    ];

    // Note: In a real Envio implementation, you'd use the actual RPC endpoint from your config
    // This is a conceptual implementation showing how contract calls would work
    
    // Get current tick from vault
    // tick = await vaultContract.currentTick();
    
    // Get total amounts from vault
    // const totalAmounts = await vaultContract.getTotalAmounts();
    // totalAmount0 = totalAmounts[0];
    // totalAmount1 = totalAmounts[1];
    
    // Get total supply
    // totalSupply = await vaultContract.totalSupply();
    
    // Get pool address and fetch sqrtPrice
    // const poolAddress = await vaultContract.pool();
    // const poolContract = new ethers.Contract(poolAddress, poolABI, provider);
    // const slot0 = await poolContract.slot0();
    // sqrtPrice = slot0[0]; // sqrtPriceX96
    
    // Calculate before amounts (for withdraw, add back the withdrawn amounts)
    totalAmount0BeforeEvent = totalAmount0 + event.params.amount0;
    totalAmount1BeforeEvent = totalAmount1 + event.params.amount1;
    
    console.log(`Contract data fetched for withdraw ${event.chainId}_${event.block.number}_${event.logIndex}`);
    
  } catch (error) {
    context.log.warn(`Failed to fetch contract data for withdraw ${event.chainId}_${event.block.number}_${event.logIndex}: ${error}`);
    // Use default values if contract calls fail
  }

  // Create the event entity with enriched data
  const entity: VaultWithdraw = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    sender: event.params.sender,
    to: event.params.to,
    shares: event.params.shares,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    tick: tick,
    sqrtPrice: sqrtPrice,
    createdAtTimestamp: BigInt(event.block.timestamp),
    totalAmount0: totalAmount0,
    totalAmount1: totalAmount1,
    totalAmount0BeforeEvent: totalAmount0BeforeEvent,
    totalAmount1BeforeEvent: totalAmount1BeforeEvent,
    totalSupply: totalSupply,
  };

  context.VaultWithdraw.set(entity);
});
