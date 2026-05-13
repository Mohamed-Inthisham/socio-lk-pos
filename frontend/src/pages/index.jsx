import { useState } from "react";
import Logo from "../../components/common/Logo";
import InputField from "../../components/common/InputField";
import Button from "../../components/common/Button";
import loginImage from "../../assets/login-image.webp";

const LoginPage = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setLoading(true);
    // Redux dispatch will go here later
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{
        background: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)",
      }}
    >
      {/* Glass Card */}
      <div
        className="
        w-full max-w-4xl rounded-3xl overflow-hidden
        bg-white/10 backdrop-blur-md
        border border-white/20
        shadow-2xl
      "
      >
        <div className="flex flex-col md:flex-row">
          {/* LEFT SIDE */}
          <div
            className="
            w-full md:w-1/2 p-10
            flex flex-col items-center justify-center gap-8
            bg-white/5 border-b md:border-b-0 md:border-r border-white/10
          "
          >
            {/* Logo */}
            <Logo size="lg" />

            {/* Illustration */}
            <img
              src={loginImage}
              alt="POS Illustration"
              className="w-64 object-contain"
            />

            {/* Description */}
            <p className="text-slate-300 text-center text-sm leading-relaxed max-w-xs">
              Manage your sales, inventory and customers all in one place with{" "}
              <span className="text-brand-accent font-semibold">
                SOCIO.LK POS
              </span>
            </p>
          </div>

          {/* RIGHT SIDE */}
          <div
            className="
            w-full md:w-1/2 p-10
            flex flex-col justify-center gap-8
          "
          >
            {/* Heading */}
            <div className="flex flex-col gap-2">
              <h2 className="text-white text-3xl font-bold">Welcome Back</h2>
              <p className="text-slate-400 text-sm">
                Sign in to your account to continue
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

              <Button
                label="Sign In"
                type="submit"
                loading={loading}
                fullWidth
              />
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
