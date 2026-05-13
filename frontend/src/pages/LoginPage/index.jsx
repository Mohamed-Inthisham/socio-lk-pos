import { useState } from "react";
import Logo from "../../components/common/Logo";
import InputField from "../../components/common/InputField";
import Button from "../../components/common/Button";
import loginImage from "../../assets/login-image.webp";

const LoginPage = () => {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.email) newErrors.email = "Email is required";
    if (!formData.password) newErrors.password = "Password is required";
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <>
      {/* MOBILE — White Background Full Screen */}
      <div
        className="min-h-screen w-full flex items-center justify-center p-6 md:hidden"
        style={{ background: "#f8fafc" }}
      >
        <div className="w-full max-w-md">
          {/* Logo Centered */}
          <div className="flex flex-col items-center gap-2 pb-8">
            <Logo size="md" />
          </div>

          {/* Heading */}
          <div className="flex flex-col gap-1 mb-6">
            <h2
              className="font-semibold text-center"
              style={{ color: "#0f172a", fontSize: "26px" }}
            >
              Welcome Back
            </h2>
            <p className="text-sm text-center" style={{ color: "#64748b" }}>
              Sign in to your account to continue
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <InputField
              label="Email Address"
              type="email"
              name="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
            />

            <InputField
              label="Password"
              type="password"
              name="password"
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange}
              error={errors.password}
            />

            <div className="pt-2">
              <Button
                label="Sign In"
                type="submit"
                loading={loading}
                fullWidth
              />
            </div>
          </form>

          {/* Footer */}
          <p className="text-center text-xs mt-8" style={{ color: "#94a3b8" }}>
            © 2025 SOCIO.LK POS. All rights reserved.
          </p>
        </div>
      </div>

      {/* TABLET & DESKTOP — Glass Card with Two Columns */}
      <div
        className="hidden md:flex min-h-screen w-full items-center justify-center p-4"
        style={{
          background:
            "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
        }}
      >
        {/* Glass Card */}
        <div
          className="w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl flex"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.13)",
            minHeight: "540px",
          }}
        >
          {/* LEFT — Full Bleed Image */}
          <div className="relative w-[55%] overflow-hidden">
            <img
              src={loginImage}
              alt="POS Illustration"
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Gradient + Description */}
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
                Manage SOCIO.LK's sales, inventory and customers all in one
                place with{" "}
                <span className="font-semibold" style={{ color: "#38bdf8" }}>
                  SOCIO.LK POS
                </span>
              </p>
            </div>
          </div>

          {/* RIGHT — WHITE PANEL */}
          <div
            className="w-[45%] flex flex-col justify-between p-9"
            style={{ background: "#ffffff" }}
          >
            {/* Logo Centered Top */}
            <div
              className="flex flex-col items-center gap-2 pb-5"
              style={{ borderBottom: "1.5px solid #e2e8f0" }}
            >
              <Logo size="sm" />
            </div>

            {/* Form Area */}
            <div className="flex flex-col gap-5 flex-1 justify-center py-5">
              {/* Heading */}
              <div className="flex flex-col gap-1">
                <h2
                  className="font-semibold"
                  style={{ color: "#0f172a", fontSize: "24px" }}
                >
                  Welcome Back
                </h2>
                <p className="text-sm" style={{ color: "#64748b" }}>
                  Sign in to your account to continue
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <InputField
                  label="Email Address"
                  type="email"
                  name="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleChange}
                  error={errors.email}
                />

                <InputField
                  label="Password"
                  type="password"
                  name="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  error={errors.password}
                />

                <div className="pt-1">
                  <Button
                    label="Sign In"
                    type="submit"
                    loading={loading}
                    fullWidth
                  />
                </div>
              </form>
            </div>

            {/* Footer */}
            <p className="text-center text-xs" style={{ color: "#94a3b8" }}>
              © 2026 SOCIO.LK POS. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default LoginPage;
