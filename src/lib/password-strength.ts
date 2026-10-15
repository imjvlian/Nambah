/**
 * Password policy for Nambah accounts.
 *
 * The rules here are deliberately split in two:
 *
 * - `requirements` are hard rules. They must pass before a signup can be
 *   accepted, and they are enforced on the server, not only in the browser.
 * - `advice` is advisory. It never blocks signup. It exists to catch the
 *   passwords that technically satisfy the rules but are still bad, such as
 *   "Aaaaaaa1" or "Password12".
 *
 * New accounts are held to these rules. Existing accounts are never
 * re-validated: login goes straight to Supabase Auth, so an older password
 * that does not meet the rules keeps working. That is why the policy lives
 * here and is called only from the signup and reset routes, and never from
 * the Supabase dashboard password settings.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordRequirementId = "length" | "uppercase" | "number";

export type PasswordRequirement = {
  id: PasswordRequirementId;
  /** Short text for the checklist under the password field. */
  label: string;
  /** Full sentence used when the requirement blocks a request. */
  message: string;
  met: boolean;
};

export type PasswordAdviceId =
  | "common"
  | "repetition"
  | "sequence"
  | "email"
  | "keyboard";

export type PasswordAdvice = {
  id: PasswordAdviceId;
  message: string;
};

export type PasswordStrengthLabel = "Lemah" | "Cukup" | "Kuat" | "Sangat kuat";

export type PasswordAssessment = {
  requirements: PasswordRequirement[];
  /** True when every hard requirement is satisfied. */
  requirementsMet: boolean;
  advice: PasswordAdvice[];
  /** 0 (weakest) to 4 (strongest). Advisory only. */
  score: 0 | 1 | 2 | 3 | 4;
  label: PasswordStrengthLabel;
};

/**
 * A deliberately small built-in list. Leaked password screening against
 * HaveIBeenPwned is a Supabase Pro feature and is not available on this
 * project's plan, so the common-password check is done here instead.
 */
const COMMON_PASSWORDS = new Set([
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "111111",
  "000000",
  "123123",
  "121212",
  "112233",
  "654321",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "asdfghjk",
  "zxcvbnm",
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "iloveyou",
  "admin",
  "admin123",
  "administrator",
  "root",
  "toor",
  "user",
  "username",
  "login",
  "letmein",
  "welcome",
  "welcome1",
  "welcome123",
  "master",
  "dragon",
  "monkey",
  "abc123",
  "abc12345",
  "abcdef",
  "abcd1234",
  "football",
  "baseball",
  "soccer",
  "superman",
  "batman",
  "sunshine",
  "princess",
  "starwars",
  "trustno1",
  "whatever",
  "freedom",
  "computer",
  "internet",
  "bismillah",
  "nambah",
  "nambah123",
  "lacte",
  "lacte123",
]);

/**
 * Runs that make a password easy to guess even when it is long enough and
 * has the required character classes.
 */
const SEQUENCE_ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

const KEYBOARD_ROWS = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
];

const SEQUENCE_MIN_RUN = 4;

function reverseString(value: string) {
  return value.split("").reverse().join("");
}

function hasSequenceRun(lower: string) {
  for (const alphabet of SEQUENCE_ALPHABETS) {
    for (const candidate of [alphabet, reverseString(alphabet)]) {
      for (let i = 0; i + SEQUENCE_MIN_RUN <= candidate.length; i += 1) {
        if (lower.includes(candidate.slice(i, i + SEQUENCE_MIN_RUN))) {
          return true;
        }
      }
    }
  }
  return false;
}

function hasKeyboardRow(lower: string) {
  for (const row of KEYBOARD_ROWS) {
    for (const candidate of [row, reverseString(row)]) {
      for (let i = 0; i + SEQUENCE_MIN_RUN <= candidate.length; i += 1) {
        if (lower.includes(candidate.slice(i, i + SEQUENCE_MIN_RUN))) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Three or more of the same character back to back, such as "aaa". */
function hasCharacterRepetition(value: string) {
  return /(.)\1{2,}/.test(value);
}

/**
 * Flags passwords built from the email itself, such as "Elina123" for
 * "elina@gmail.com". Only the local part is considered, and only when it is
 * long enough to be a deliberate choice rather than a coincidence.
 */
function looksLikeEmail(password: string, email: string) {
  const localPart = email.split("@")[0] ?? "";
  if (localPart.length < 5) return false;

  const lowerPassword = password.toLowerCase();
  const lowerLocal = localPart.toLowerCase();

  return (
    lowerPassword.includes(lowerLocal) ||
    lowerPassword.includes(reverseString(lowerLocal))
  );
}

/**
 * Length is the dominant factor. Complexity rules are handled separately in
 * `requirements`, so this score stays focused on how much guessing it would
 * take: a long passphrase outscores a short string stuffed with symbols.
 */
function lengthScore(length: number): 0 | 1 | 2 | 3 | 4 {
  if (length < MIN_PASSWORD_LENGTH) return 0;
  if (length < 12) return 1;
  if (length < 16) return 2;
  if (length < 20) return 3;
  return 4;
}

function strengthLabel(score: number): PasswordStrengthLabel {
  if (score <= 1) return "Lemah";
  if (score === 2) return "Cukup";
  if (score === 3) return "Kuat";
  return "Sangat kuat";
}

function buildRequirements(password: string): PasswordRequirement[] {
  return [
    {
      id: "length",
      label: `Panjang minimal ${MIN_PASSWORD_LENGTH} karakter`,
      message: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: "uppercase",
      label: "Ada huruf besar (A-Z)",
      message: "Password harus mengandung minimal satu huruf besar (A-Z).",
      met: /[A-Z]/.test(password),
    },
    {
      id: "number",
      label: "Ada angka (0-9)",
      message: "Password harus mengandung minimal satu angka (0-9).",
      met: /[0-9]/.test(password),
    },
  ];
}

function buildAdvice(password: string, email: string): PasswordAdvice[] {
  const advice: PasswordAdvice[] = [];
  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    advice.push({
      id: "common",
      message: "Password ini sangat umum dan mudah ditebak.",
    });
  }

  if (hasCharacterRepetition(password)) {
    advice.push({
      id: "repetition",
      message: "Hanya mengulang karakter yang sama, mudah ditebak.",
    });
  }

  if (hasSequenceRun(lower)) {
    advice.push({
      id: "sequence",
      message: "Ada karakter yang berurutan, mudah ditebak.",
    });
  }

  if (hasKeyboardRow(lower)) {
    advice.push({
      id: "keyboard",
      message: "Mirip susunan tombol keyboard.",
    });
  }

  if (looksLikeEmail(password, email)) {
    advice.push({
      id: "email",
      message: "Mirip nama email kamu, mudah ditebak.",
    });
  }

  return advice;
}

export function assessPassword(
  password: string,
  email = "",
): PasswordAssessment {
  const requirements = buildRequirements(password);
  const advice = buildAdvice(password, email);

  let score = lengthScore(password.length);
  for (const item of advice) {
    if (item.id === "common") {
      score = 0;
      continue;
    }
    score = Math.max(0, score - 1) as 0 | 1 | 2 | 3 | 4;
  }

  return {
    requirements,
    requirementsMet: requirements.every((item) => item.met),
    advice,
    score,
    label: strengthLabel(score),
  };
}

/**
 * The server-side gate. Returns the first unmet requirement message, or null
 * when the password satisfies every hard rule.
 */
export function passwordPolicyError(
  password: string,
  email = "",
): string | null {
  const assessment = assessPassword(password, email);
  const failed = assessment.requirements.find((item) => !item.met);
  return failed ? failed.message : null;
}

/**
 * Confirms the two password fields match. Comparison is exact and neither
 * value is trimmed: a password that legitimately starts or ends with a space
 * should still confirm successfully.
 */
export function passwordConfirmationError(
  password: string,
  confirmPassword: string,
): string | null {
  if (!confirmPassword) return "Konfirmasi password belum diisi.";
  if (password !== confirmPassword) return "Konfirmasi password tidak sama.";
  return null;
}