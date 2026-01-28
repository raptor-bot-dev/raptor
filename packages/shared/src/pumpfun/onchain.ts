import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS, type BondingCurveState } from '../chains/solana.js';
import { SOLANA_CONFIG } from '../constants.js';

const connection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');

const CACHE_TTL_MS = 15000;
const bondingCurveCache = new Map<string, { data: BondingCurveSnapshot; expiry: number }>();
const mintInfoCache = new Map<string, { data: MintInfo; expiry: number }>();

export interface BondingCurveSnapshot {
  programId: string;
  bondingCurve: string;
  state: BondingCurveState;
}

export interface MintInfo {
  decimals: number;
  supply: number;
  supplyRaw: bigint;
}

export async function getBondingCurveSnapshot(mint: string): Promise<BondingCurveSnapshot | null> {
  const cached = bondingCurveCache.get(mint);
  const now = Date.now();
  if (cached && now < cached.expiry) {
    return cached.data;
  }

  const mintKey = new PublicKey(mint);
  // Include Meteora DBC for BAGS tokens, with pump.fun as fallback
  // Note: Meteora DBC uses the same PDA seeds ('bonding-curve') but different account layout
  // The decoder handles both formats via try/catch
  const programIds = [PROGRAM_IDS.METEORA_DBC, PROGRAM_IDS.PUMP_FUN, PROGRAM_IDS.PUMP_PRO];

  for (const programId of programIds) {
    const programKey = new PublicKey(programId);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintKey.toBuffer()],
      programKey
    );

    try {
      const accountInfo = await connection.getAccountInfo(bondingCurve);
      if (!accountInfo || accountInfo.data.length < 49) {
        continue;
      }

      if (!accountInfo.owner.equals(programKey)) {
        continue;
      }

      const state = decodeBondingCurveState(Buffer.from(accountInfo.data));
      const snapshot: BondingCurveSnapshot = {
        programId,
        bondingCurve: bondingCurve.toBase58(),
        state,
      };

      bondingCurveCache.set(mint, { data: snapshot, expiry: now + CACHE_TTL_MS });
      return snapshot;
    } catch {
      continue;
    }
  }

  return null;
}

export async function getMintInfo(mint: string): Promise<MintInfo | null> {
  const cached = mintInfoCache.get(mint);
  const now = Date.now();
  if (cached && now < cached.expiry) {
    return cached.data;
  }

  try {
    const mintKey = new PublicKey(mint);
    const supplyInfo = await connection.getTokenSupply(mintKey);
    const supplyRaw = BigInt(supplyInfo.value.amount);
    const decimals = supplyInfo.value.decimals;
    const supply = Number(supplyRaw) / Math.pow(10, decimals);

    const info: MintInfo = { decimals, supply, supplyRaw };
    mintInfoCache.set(mint, { data: info, expiry: now + CACHE_TTL_MS });
    return info;
  } catch {
    try {
      const mintKey = new PublicKey(mint);
      const parsed = await connection.getParsedAccountInfo(mintKey);
      const info = parsed.value?.data && typeof parsed.value.data === 'object'
        ? (parsed.value.data as { parsed?: { info?: { decimals?: number; supply?: string } } }).parsed?.info
        : undefined;
      const decimals = info?.decimals;
      const supplyRaw = info?.supply ? BigInt(info.supply) : 0n;

      if (decimals === undefined) {
        return null;
      }

      const supply = Number(supplyRaw) / Math.pow(10, decimals);
      const mintInfo = { decimals, supply, supplyRaw };
      mintInfoCache.set(mint, { data: mintInfo, expiry: now + CACHE_TTL_MS });
      return mintInfo;
    } catch {
      return null;
    }
  }
}

function decodeBondingCurveState(data: Buffer): BondingCurveState {
  let offset = 8;

  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;

  const virtualSolReserves = data.readBigUInt64LE(offset);
  offset += 8;

  const realTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;

  const realSolReserves = data.readBigUInt64LE(offset);
  offset += 8;

  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;

  const complete = data.readUInt8(offset) === 1;
  offset += 1;

  const creatorBytes = data.slice(offset, offset + 32);
  const creator = new PublicKey(creatorBytes).toBase58();

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
  };
}
