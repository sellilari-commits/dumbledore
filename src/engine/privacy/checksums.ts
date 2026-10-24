/** Checksum helpers for redaction: Luhn (card numbers) and ISO 13616 mod-97 (IBANs). */

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** ISO 13616 check: move the first four chars to the end, letters → 10..35, mod 97 must be 1. */
export function ibanChecksumValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    const value = code >= 65 ? String(code - 55) : ch
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
  }
  return remainder === 1
}

/**
 * True for a valid IBAN, and also for IBAN-shaped strings that are mostly digits (an OCR misread
 * breaks the checksum but the number is still personal data).
 */
export function ibanLooksValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34) return false
  if (ibanChecksumValid(iban)) return true
  const digits = iban.slice(2).replace(/\D/g, '').length
  return digits / (iban.length - 2) >= 0.75
}
