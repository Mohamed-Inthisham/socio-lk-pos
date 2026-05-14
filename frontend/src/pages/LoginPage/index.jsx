import Logo from "../../components/common/Logo";
import LoginForm from "../../components/auth/LoginForm";
import loginImage from "../../assets/login-image.webp";

const LoginPage = () => {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{
        background:
          "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
      }}
    >
      {/* Card Wrapper */}
      <div
        className="w-full max-w-md md:max-w-5xl rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row"
        style={{
          minHeight: "540px",
        }}
      >
        {/* LEFT — Image with Glass BG (desktop only) */}
        <div
          className="relative w-full md:w-[55%] hidden md:block overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <img
            src={loginImage}
            alt="POS Illustration"
            className="absolute inset-0 w-full h-full object-cover"
          />

          <div
            className="absolute bottom-0 left-0 right-0 px-6 pb-5 pt-16 text-center"
            style={{
              background:
                "linear-gradient(to top, rgba(15,32,39,0.92), transparent)",
            }}
          >
            <p
              className="text-xs leading-relaxed"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Manage your sales, inventory and customers all in one place with{" "}
              <span className="font-semibold" style={{ color: "#38bdf8" }}>
                SOCIO.LK POS
              </span>
            </p>
          </div>
        </div>

        {/* RIGHT — Form Panel (white) */}
        <div
          className="w-full md:w-[45%] flex flex-col justify-between p-6 md:p-9"
          style={{ background: "#ffffff" }}
        >
          {/* Logo */}
          <div
            className="flex flex-col items-center gap-2 pb-6 md:pb-5"
            style={{ borderBottom: "1.5px solid #e2e8f0" }}
          >
            <Logo size="sm" />
          </div>

          {/* Form Area */}
          <div className="flex flex-col gap-5 flex-1 justify-center py-5">
            {/* Heading */}
            <div className="flex flex-col gap-1">
              <h2
                className="font-semibold text-center md:text-left"
                style={{ color: "#0f172a", fontSize: "24px" }}
              >
                Welcome Back
              </h2>
              <p
                className="text-sm text-center md:text-left"
                style={{ color: "#64748b" }}
              >
                Sign in to your account to continue
              </p>
            </div>

            {/* Form */}
            <LoginForm />
          </div>

          {/* Footer */}
          <p className="text-center text-xs" style={{ color: "#94a3b8" }}>
            © 2025 SOCIO.LK POS. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
