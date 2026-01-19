import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS, SOLANA_CONFIG } from '@raptor/shared';
import { loadPumpIdl } from './pumpIdl.js';

export interface FeeRecipientResolutionInput {
  mint: string;
  bondingCurve: string;
  programId: string;
}

export interface FeeRecipientResolutionOutput {
  feeRecipient: string;
  mode: 'NORMAL' | 'MAYHEM';
  source: 'GLOBAL_CONFIG' | 'GLOBAL_RESERVED_FIELDS' | 'ENV_OVERRIDE';
  debug: {
    isMayhemMode?: boolean;
    global?: string;
    globalConfig?: string;
  };
}

const connection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');
const GLOBAL_CACHE_TTL_MS = 60_000;
const FEE_CACHE_TTL_MS = 30_000;

let globalCache: { data: Record<string, unknown>; expiry: number; address: string } | null = null;
const feeCache = new Map<string, { data: FeeRecipientResolutionOutput; expiry: number }>();

const ZERO_PUBKEY = '11111111111111111111111111111111';

function isZeroPubkey(value: string | null | undefined): boolean {
  if (!value) return true;
  return value === ZERO_PUBKEY;
}

function toPubkeyString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'toBase58' in value) {
    const key = value as { toBase58: () => string };
    return key.toBase58();
  }
  return null;
}

function findCandidateKey(
  candidates: Array<string | null>,
  arrays: Array<unknown[] | null | undefined>
): string | null {
  for (const value of candidates) {
    if (value && !isZeroPubkey(value)) {
      return value;
    }
  }

  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) {
      const key = toPubkeyString(item);
      if (key && !isZeroPubkey(key)) {
        return key;
      }
    }
  }

  return null;
}

function getGlobalAddress(programId: string): PublicKey {
  if (programId === PROGRAM_IDS.PUMP_PRO && process.env.PUMP_PRO_GLOBAL_STATE) {
    return new PublicKey(process.env.PUMP_PRO_GLOBAL_STATE);
  }
  return new PublicKey(PROGRAM_IDS.PUMP_FUN_GLOBAL);
}

async function decodeAccount<T>(
  accountName: string,
  data: Buffer
): Promise<T | null> {
  const { coder } = loadPumpIdl();
  try {
    return coder.decode(accountName, data) as T;
  } catch (error) {
    console.error(`[FeeRecipient] Failed to decode ${accountName}:`, error);
    return null;
  }
}

async function loadGlobal(programId: string): Promise<Record<string, unknown>> {
  const globalKey = getGlobalAddress(programId);

  if (globalCache && globalCache.address === globalKey.toBase58() && Date.now() < globalCache.expiry) {
    return globalCache.data;
  }

  const accountInfo = await connection.getAccountInfo(globalKey);
  if (!accountInfo) {
    throw new Error(`[FeeRecipient] Global account not found: ${globalKey.toBase58()}`);
  }

  const decoded = await decodeAccount<Record<string, unknown>>('Global', Buffer.from(accountInfo.data));
  if (!decoded) {
    throw new Error('[FeeRecipient] Failed to decode Global account from IDL');
  }

  globalCache = {
    data: decoded,
    expiry: Date.now() + GLOBAL_CACHE_TTL_MS,
    address: globalKey.toBase58(),
  };

  return decoded;
}

async function loadBondingCurve(bondingCurve: string): Promise<Record<string, unknown>> {
  const curveKey = new PublicKey(bondingCurve);
  const accountInfo = await connection.getAccountInfo(curveKey);
  if (!accountInfo) {
    throw new Error(`[FeeRecipient] Bonding curve account not found: ${bondingCurve}`);
  }

  const decoded = await decodeAccount<Record<string, unknown>>('BondingCurve', Buffer.from(accountInfo.data));
  if (!decoded) {
    throw new Error('[FeeRecipient] Failed to decode BondingCurve account from IDL');
  }

  return decoded;
}

export async function resolveFeeRecipient(
  input: FeeRecipientResolutionInput
): Promise<FeeRecipientResolutionOutput> {
  const override = process.env.PUMP_OVERRIDE_FEE_RECIPIENT;
  if (override) {
    return {
      feeRecipient: override,
      mode: 'NORMAL',
      source: 'ENV_OVERRIDE',
      debug: {},
    };
  }

  const cacheKey = `${input.programId}:${input.bondingCurve}`;
  const cached = feeCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  const bondingCurve = await loadBondingCurve(input.bondingCurve);
  const isMayhemMode = Boolean(
    (bondingCurve as { is_mayhem_mode?: boolean }).is_mayhem_mode ??
    (bondingCurve as { isMayhemMode?: boolean }).isMayhemMode
  );

  const global = await loadGlobal(input.programId);

  const globalData = global as {
    fee_recipient?: unknown;
    fee_recipients?: unknown[];
    reserved_fee_recipient?: unknown;
    reserved_fee_recipients?: unknown[];
  };

  let feeRecipient: string | null = null;
  let source: FeeRecipientResolutionOutput['source'] = 'GLOBAL_CONFIG';

  if (isMayhemMode) {
    feeRecipient = findCandidateKey(
      [toPubkeyString(globalData.reserved_fee_recipient)],
      [globalData.reserved_fee_recipients]
    );
    source = 'GLOBAL_RESERVED_FIELDS';
  } else {
    feeRecipient = findCandidateKey(
      [toPubkeyString(globalData.fee_recipient)],
      [globalData.fee_recipients]
    );
  }

  if (!feeRecipient) {
    throw new Error('[FeeRecipient] Unable to resolve fee recipient from Global config');
  }

  const resolved: FeeRecipientResolutionOutput = {
    feeRecipient,
    mode: isMayhemMode ? 'MAYHEM' : 'NORMAL',
    source,
    debug: {
      isMayhemMode,
      global: getGlobalAddress(input.programId).toBase58(),
    },
  };

  feeCache.set(cacheKey, { data: resolved, expiry: Date.now() + FEE_CACHE_TTL_MS });
  return resolved;
}
