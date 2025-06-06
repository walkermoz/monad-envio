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

// Import viem at the top level as recommended by Envio docs
import { createPublicClient, http, getContract } from 'viem';
import { mainnet, polygon, arbitrum, base, optimism } from 'viem/chains';

// Import ABIs from organized folder structure
import { VAULT_ABI, POOL_ABI } from './abis';

// Create public client helper - following Envio's external calls pattern
function createViemClient(chainId: number) {
  const INFURA_API_KEY = '4798af18ca8244b78f03456b5d69823d';
  let chain;
  let rpcUrl;
  
  switch (chainId) {
    case 1:
      chain = mainnet;
      rpcUrl = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`;
      break;
    case 137:
      chain = polygon;
      rpcUrl = `https://polygon-mainnet.infura.io/v3/${INFURA_API_KEY}`;
      break;
    case 42161:
      chain = arbitrum;
      rpcUrl = `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`;
      break;
    case 8453:
      chain = base;
      rpcUrl = 'https://mainnet.base.org'; // Base public RPC (Infura doesn't support Base)
      break;
    case 10:
      chain = optimism;
      rpcUrl = `https://optimism-mainnet.infura.io/v3/${INFURA_API_KEY}`;
      break;
    default:
      chain = mainnet;
      rpcUrl = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`; // fallback
  }
  
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
    batch: { multicall: true }
  });
}



async function fetchVaultData(vaultAddress: string, chainId: number, context: any) {
  try {
    const client = createViemClient(chainId);
    
    const vaultResults = await client.multicall({
      allowFailure: false,
      contracts: [
        {
          address: vaultAddress as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'currentTick'
        },
        {
          address: vaultAddress as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'getTotalAmounts'
        },
        {
          address: vaultAddress as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'totalSupply'
        },
        {
          address: vaultAddress as `0x${string}`,
          abi: VAULT_ABI,
          functionName: 'pool'
        }
      ]
    });

    const [tick, totalAmounts, totalSupply, poolAddress] = vaultResults;

    // Fetch pool data
    const poolResults = await client.multicall({
      allowFailure: false,
      contracts: [
        {
          address: poolAddress as `0x${string}`,
          abi: POOL_ABI,
          functionName: 'slot0'
        }
      ]
    });

    const [slot0] = poolResults;
    
    return {
      tick: Number(tick),
      totalAmount0: (totalAmounts as [bigint, bigint])[0],
      totalAmount1: (totalAmounts as [bigint, bigint])[1],
      totalSupply: totalSupply as bigint,
      sqrtPrice: (slot0 as any[])[0], // sqrtPriceX96
      success: true
    };
  } catch (error) {
    context.log.warn(`Failed to fetch vault data for ${vaultAddress} on chain ${chainId}: ${error}`);
    return {
      tick: 0,
      totalAmount0: BigInt(0),
      totalAmount1: BigInt(0),
      totalSupply: BigInt(0),
      sqrtPrice: BigInt(0),
      success: false
    };
  }
}

// Helper function to safely calculate before amounts - prevents negative values
function calculateBeforeAmounts(
  currentTotal0: bigint,
  currentTotal1: bigint,
  eventAmount0: bigint,
  eventAmount1: bigint,
  isDeposit: boolean,
  context: any,
  eventId: string
) {
  let beforeAmount0: bigint;
  let beforeAmount1: bigint;

  if (isDeposit) {
    // For deposits: before = current - deposited
    beforeAmount0 = currentTotal0 - eventAmount0;
    beforeAmount1 = currentTotal1 - eventAmount1;
  } else {
    // For withdrawals: before = current + withdrawn
    beforeAmount0 = currentTotal0 + eventAmount0;
    beforeAmount1 = currentTotal1 + eventAmount1;
  }

  // Validate amounts are not negative (which doesn't make sense for token amounts)
  if (beforeAmount0 < 0n) {
    context.log.warn(`Calculated negative beforeAmount0 (${beforeAmount0.toString()}) for ${eventId}, setting to 0`);
    beforeAmount0 = BigInt(0);
  }
  
  if (beforeAmount1 < 0n) {
    context.log.warn(`Calculated negative beforeAmount1 (${beforeAmount1.toString()}) for ${eventId}, setting to 0`);
    beforeAmount1 = BigInt(0);
  }

  return {
    totalAmount0BeforeEvent: beforeAmount0,
    totalAmount1BeforeEvent: beforeAmount1
  };
}

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
  // Fetch vault data using the helper function - follows Envio's external calls pattern
  const vaultData = await fetchVaultData(event.srcAddress, event.chainId, context);
  
  // Calculate before amounts safely - prevents negative values
  const eventId = `${event.chainId}_${event.block.number}_${event.logIndex}`;
  const beforeAmounts = calculateBeforeAmounts(
    vaultData.totalAmount0,
    vaultData.totalAmount1,
    event.params.amount0,
    event.params.amount1,
    true, // isDeposit
    context,
    eventId
  );
  
  if (vaultData.success) {
    context.log.info(`Successfully fetched contract data for deposit ${eventId} - sqrtPrice: ${vaultData.sqrtPrice.toString()}`);
  }

  // Create the event entity with enriched data
  const entity: VaultDeposit = {
    id: eventId,
    vault: event.srcAddress,
    sender: event.params.sender,
    to: event.params.to,
    shares: event.params.shares,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    tick: vaultData.tick,
    createdAtTimestamp: BigInt(event.block.timestamp),
    sqrtPrice: vaultData.sqrtPrice,
    totalAmount0: vaultData.totalAmount0,
    totalAmount1: vaultData.totalAmount1,
    totalAmount0BeforeEvent: beforeAmounts.totalAmount0BeforeEvent,
    totalAmount1BeforeEvent: beforeAmounts.totalAmount1BeforeEvent,
    totalSupply: vaultData.totalSupply,
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
  // Fetch vault data using the helper function - follows Envio's external calls pattern
  const vaultData = await fetchVaultData(event.srcAddress, event.chainId, context);
  
  if (vaultData.success) {
    context.log.info(`Successfully fetched contract data for rebalance ${event.chainId}_${event.block.number}_${event.logIndex} - sqrtPrice: ${vaultData.sqrtPrice.toString()}`);
  }

  // Create the event entity with enriched data
  const entity: VaultRebalance = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vault: event.srcAddress,
    tick: vaultData.tick,
    createdAtTimestamp: BigInt(event.block.timestamp),
    sqrtPrice: vaultData.sqrtPrice,
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
      context.log.error("fromUserVaultShare is null/undefined for vault:", event.srcAddress, "user:", event.params.from);
      context.log.error("Skipping from user balance update");
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
      context.log.error("toUserVaultShare is null/undefined for vault:", event.srcAddress, "user:", event.params.to);
      context.log.error("Skipping to user balance update");
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
      context.log.info(`Vault ${event.srcAddress} became active with ${holdersCount} holders`);
    } else if (wasActiveVault && !isActiveVault) {
      // Vault became inactive
      context.log.info(`Vault ${event.srcAddress} became inactive`);
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
  // Fetch vault data using the helper function - follows Envio's external calls pattern
  const vaultData = await fetchVaultData(event.srcAddress, event.chainId, context);
  
  // Calculate before amounts safely - prevents negative values
  const eventId = `${event.chainId}_${event.block.number}_${event.logIndex}`;
  const beforeAmounts = calculateBeforeAmounts(
    vaultData.totalAmount0,
    vaultData.totalAmount1,
    event.params.amount0,
    event.params.amount1,
    false, // isDeposit = false for withdrawals
    context,
    eventId
  );
  
  if (vaultData.success) {
    context.log.info(`Successfully fetched contract data for withdraw ${eventId} - sqrtPrice: ${vaultData.sqrtPrice.toString()}`);
  }

  // Create the event entity with enriched data
  const entity: VaultWithdraw = {
    id: eventId,
    vault: event.srcAddress,
    sender: event.params.sender,
    to: event.params.to,
    shares: event.params.shares,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    tick: vaultData.tick,
    sqrtPrice: vaultData.sqrtPrice,
    createdAtTimestamp: BigInt(event.block.timestamp),
    totalAmount0: vaultData.totalAmount0,
    totalAmount1: vaultData.totalAmount1,
    totalAmount0BeforeEvent: beforeAmounts.totalAmount0BeforeEvent,
    totalAmount1BeforeEvent: beforeAmounts.totalAmount1BeforeEvent,
    totalSupply: vaultData.totalSupply,
  };

  context.VaultWithdraw.set(entity);
});
