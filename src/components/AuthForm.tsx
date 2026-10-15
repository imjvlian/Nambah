"use client";

import LoginForm from "@/components/LoginForm";
import SignupForm from "@/components/SignupForm";

type AuthFormProps = {
  mode: "login" | "register";
  nextPath?: string;
  confirmed?: boolean;
  oauthError?: string;
};

/**
 * Kept as a thin dispatcher so the login and register pages do not each have
 * to know which form they are rendering.
 */
export default function AuthForm({
  mode,
  nextPath,
  confirmed,
  oauthError,
}: AuthFormProps) {
  if (mode === "register") return <SignupForm nextPath={nextPath} />;
  return (
    <LoginForm
      nextPath={nextPath}
      confirmed={confirmed}
      oauthError={oauthError}
    />
  );
}