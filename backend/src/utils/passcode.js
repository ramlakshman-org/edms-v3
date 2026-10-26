import crypto from 'crypto';

// Strong 6-digit passcodes: cryptographically random (crypto.randomInt, not the
// predictable Math.random) and screened so obvious patterns (111111, 123456,
// 000000, simple runs, a small common-code blocklist) are never issued. The full
// 000000–999999 range is used (leading zeros allowed) for maximum entropy.

const WEAK = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777',
  '888888', '999999', '123456', '654321', '121212', '123123', '112233', '102030',
  '696969', '123321', '456789', '987654', '147258', '159357', '011011',
]);

const ASC = '0123456789';
const DESC = '9876543210';

function isWeakPasscode(code) {
  if (WEAK.has(code)) return true;
  if (/^(\d)\1{5}$/.test(code)) return true;            // all identical digits
  if (ASC.includes(code) || DESC.includes(code)) return true; // sequential run (e.g. 012345, 543210)
  return false;
}

/** Cryptographically-strong, non-obvious 6-digit login passcode. */
export function genPasscode() {
  for (let i = 0; i < 64; i += 1) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!isWeakPasscode(code)) return code;
  }
  // Extremely unlikely fallback (still crypto-random, just skips the weak screen).
  return String(crypto.randomInt(100000, 1000000));
}

/** Strong random 6-digit one-time code (OTP). */
export function genOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** True if a passcode meets the minimum policy (6 digits, not an obvious pattern). */
export function isStrongPasscode(code) {
  const s = String(code || '');
  if (!/^\d{6}$/.test(s)) return false;
  return !isWeakPasscode(s);
}

export { isWeakPasscode };
