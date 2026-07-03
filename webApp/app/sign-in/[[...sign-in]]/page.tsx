import { SignIn } from "@clerk/nextjs";

// Sign-in SAHAJA, tiada laluan sign-up public: akses team finance diurus
// melalui invite/allowlist dalam Clerk (mod Restricted).
export default function SignInPage() {
  return (
    <div className="authShell">
      <div className="authBrand">
        <div className="authWordmark">DICCI</div>
        <div className="authSub">Group Finance</div>
      </div>
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#0A3D45",
            colorForeground: "#1E3B40",
            fontFamily: "var(--body)",
            borderRadius: "12px",
          },
          elements: {
            headerTitle: { fontFamily: "var(--display)", color: "#0E2E33" },
          },
        }}
      />
      <div className="authFoot">Restricted access · Finance team only</div>
    </div>
  );
}
