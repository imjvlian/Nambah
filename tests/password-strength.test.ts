import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  assessPassword,
  passwordConfirmationError,
  passwordPolicyError,
} from "../src/lib/password-strength.ts";

test("password must meet the minimum length", () => {
  const short = "Ab1!xyz";
  assert.equal(short.length, MIN_PASSWORD_LENGTH - 1);
  assert.match(passwordPolicyError(short, "") ?? "", /minimal 8 karakter/i);
  assert.equal(passwordPolicyError("Abcdefg1", ""), null);
});

test("length is counted exactly, not trimmed", () => {
  // Eight characters including a leading space. If this value were trimmed
  // before measuring, only seven characters would remain and the password
  // would be rejected for no reason: the space is a real character.
  const padded = " Abcde1g";
  assert.equal(padded.length, 8);
  assert.equal(passwordPolicyError(padded, ""), null);
  assert.match(passwordPolicyError("Abcde1g", "") ?? "", /minimal 8 karakter/i);
});

test("an uppercase letter is required", () => {
  assert.match(
    passwordPolicyError("abcdefgh1", "") ?? "",
    /huruf besar/i,
  );
  assert.equal(passwordPolicyError("Abcdefgh1", ""), null);
});

test("a digit is required", () => {
  assert.match(passwordPolicyError("Abcdefgh", "") ?? "", /angka/i);
  assert.equal(passwordPolicyError("Abcdefgh1", ""), null);
});

test("the first unmet requirement is the one reported", () => {
  // Too short and missing both character classes: the length rule wins
  // because it is the one that explains the most at that point.
  assert.match(passwordPolicyError("abc", "") ?? "", /minimal 8 karakter/i);
});

test("a valid password produces three ticked requirements", () => {
  const result = assessPassword("Rumah123", " EMAIL domain test ");
  assert.equal(result.requirementsMet, true);
  assert.equal(result.requirements.length, 3);
  assert.equal(
    result.requirements.every((item) => item.met),
    true,
  );
});

test("assessment lists requirements as unmet when the password is empty", () => {
  const result = assessPassword("");
  assert.equal(result.requirementsMet, false);
  assert.equal(
    result.requirements.filter((item) => !item.met).length,
    3,
  );
});

test("common passwords are flagged even when they satisfy the rules", () => {
  const result = assessPassword("Password1");
  assert.equal(result.requirementsMet, true);
  assert.ok(result.advice.some((item) => item.id === "common"));
  // A listed password is pinned to the bottom regardless of length.
  assert.equal(result.score, 0);
  assert.equal(result.label, "Lemah");
});

test("repeated characters are flagged", () => {
  const result = assessPassword("Aaaaaaa1");
  assert.ok(result.advice.some((item) => item.id === "repetition"));
});

test("sequential characters are flagged", () => {
  const result = assessPassword("Abcdefg1");
  assert.ok(result.advice.some((item) => item.id === "sequence"));
});

test("keyboard walks are flagged", () => {
  const result = assessPassword("Qwerty12");
  assert.ok(result.advice.some((item) => item.id === "keyboard"));
});

test("passwords built from the email are flagged", () => {
  const result = assessPassword("Elinapromedia1", "elinapromedia@gmail.com");
  assert.ok(result.advice.some((item) => item.id === "email"));
});

test("a short email local part is not treated as a match", () => {
  // "abc" is too short to be a deliberate choice, so an incidental match
  // should not accuse the user of reusing their address.
  const result = assessPassword("Xabc1234", "abc@gmail.com");
  assert.equal(
    result.advice.some((item) => item.id === "email"),
    false,
  );
});

test("the score rises with length and the label follows it", () => {
  assert.equal(assessPassword("Kucing99").score, 1);
  assert.equal(assessPassword("Kucing perched").score, 2);
  assert.equal(assessPassword("Kucing perched meo").score, 3);
  assert.equal(assessPassword("Kucing perched meows").score, 4);
  assert.equal(assessPassword("Kucing perched meo").label, "Kuat");
  assert.equal(assessPassword("Kucing perched meows").label, "Sangat kuat");
});

test("advice lowers the score but never blocks signup", () => {
  const flagged = assessPassword("Abcdefg1", "");
  assert.ok(flagged.advice.length > 0);
  assert.ok(flagged.score < 2);
  // The hard requirements still pass, which is what the form gates on.
  assert.equal(flagged.requirementsMet, true);
});

test("confirmation requires a value and an exact match", () => {
  assert.match(
    passwordConfirmationError("Rahasia123", "") ?? "",
    /belum diisi/i,
  );
  assert.match(
    passwordConfirmationError("Rahasia123", "Rahasia124") ?? "",
    /tidak sama/i,
  );
  assert.equal(passwordConfirmationError("Rahasia123", "Rahasia123"), null);
});

test("confirmation compares exactly without trimming", () => {
  // Trimming here would let " pass " confirm against "pass", and the two
  // would then be sent to Supabase as different passwords.
  assert.match(
    passwordConfirmationError("Rahasia 123", "Rahasia123") ?? "",
    /tidak sama/i,
  );
  assert.equal(passwordConfirmationError("Rahasia 123", "Rahasia 123"), null);
});