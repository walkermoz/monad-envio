export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const ZERO_BI = BigInt(0)
export const ONE_BI = BigInt(1)
export const ZERO_BD = 0n
export const ONE_BD = 1n
export const BI_18 = BigInt(18)

export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): bigint {
  if (exchangeDecimals === ZERO_BI) {
    return tokenAmount
  }
  return tokenAmount / exponentToBigDecimal(exchangeDecimals)
}

function exponentToBigDecimal(decimals: bigint): bigint {
  let bd = BigInt(1)
  for (let i = ZERO_BI; i < decimals; i = i + ONE_BI) {
    bd = bd * BigInt(10)
  }
  return bd
}

export async function createUser(address: string, context: any): Promise<void> {
  let user = await context.User.get(address)
  if (user === null) {
    user = {
      id: address,
    }
    await context.User.set(user)
  }
}

export async function createVaultShare(vault: string, user: string, context: any): Promise<any> {
  const id = `${vault}-${user}`
  console.log(`Creating/getting vault share for id: ${id}`)
  
  try {
    let vaultShare = await context.VaultShare.get(id)
    if (vaultShare === null || vaultShare === undefined) {
      console.log(`VaultShare ${id} not found, creating new one`)
      
      // Ensure user exists
      await createUser(user, context)
      
      // Check if vault exists, if not create a minimal entry
      let ichiVault = await context.IchiVault.get(vault)
      if (ichiVault === null || ichiVault === undefined) {
        console.log(`IchiVault ${vault} not found, creating minimal entry`)
        // Create a minimal vault entry for vaults that weren't created through the factory
        // or were created before the indexer started
        ichiVault = {
          id: vault,
          sender: "",
          tokenA: "",
          allowTokenA: false,
          tokenB: "",
          allowTokenB: false,
          count: BigInt(0),
          fee: BigInt(0),
          createdAtTimestamp: BigInt(0),
          holdersCount: 0,
        }
        await context.IchiVault.set(ichiVault)
        console.log(`Created minimal IchiVault: ${vault}`)
      }

      // Create the vault share with proper entity references
      vaultShare = {
        id: id,
        vaultShareBalance: ZERO_BD,
        vault_id: vault,  // Use _id suffix for entity references
        user_id: user     // Use _id suffix for entity references
      }
      await context.VaultShare.set(vaultShare)
      console.log(`Created new VaultShare: ${id}`)
    } else {
      console.log(`Found existing VaultShare: ${id}`)
    }
    
    // Verify the object before returning
    if (!vaultShare) {
      console.error(`VaultShare is still null/undefined after creation for id: ${id}`)
      return null
    }
    
    console.log(`Returning VaultShare with balance: ${vaultShare.vaultShareBalance}`)
    return vaultShare
  } catch (error) {
    console.error(`Error in createVaultShare for ${id}:`, error)
    return null
  }
} 