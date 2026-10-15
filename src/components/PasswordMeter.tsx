"use client";

import { assessPassword } from "@/lib/password-strength";

type PasswordMeterProps = {
  password: string;
  email?: string;
  /** Hides the strength bar, keeping only the blocking checklist. */
  compact?: boolean;
};

/**
 * Two panels with different jobs, kept visually separate on purpose.
 *
 * The checklist is a hard requirement: the form cannot be submitted until
 * every row is ticked. The bar underneath is advisory and never blocks,
 * because the habits that make a password genuinely weak (common words,
 * repeats, keyboard walks) cannot be turned into a rule without pushing people
 * towards the same guessable pattern the rule is meant to prevent.
 */
export default function PasswordMeter({
  password,
  email = "",
  compact = false,
}: PasswordMeterProps) {
  if (!password) return null;

  const { requirements, requirementsMet, advice, score, label } = assessPassword(
    password,
    email,
  );

  return (
    <div className="password-meter">
      <ul className="password-requirements">
        {requirements.map((item) => (
          <li key={item.id} className={item.met ? "met" : "pending"}>
            <span aria-hidden="true" className="password-check">
              {item.met ? "\u2713" : "\u25CB"}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      {!compact && (
        <div className="password-strength">
          <div className="password-strength-bar" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={
                  score > index && requirementsMet ? "on" : "off"
                }
              />
            ))}
          </div>
          <p className="password-strength-label" aria-live="polite">
            {label}
            {advice.length > 0 && (
              <span className="password-advice">{advice[0].message}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}