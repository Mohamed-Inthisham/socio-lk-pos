import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useLocation } from "react-router-dom";
import InputField from "../../common/InputField";
import Button from "../../common/Button";
import { loginUser, clearError } from "../../../store/slices/authSlice";

const LoginForm = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, error, isAuthenticated } = useSelector(
    (state) => state.auth,
  );

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});

  // Get the page user was trying to access before login
  const from = location.state?.from?.pathname || "/dashboard";

  // Redirect to intended page after successful login
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // Clear Redux error when component unmounts
  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
    if (error) dispatch(clearError());
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

    dispatch(
      loginUser({
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      }),
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <InputField
        label="Email"
        type="email"
        name="email"
        placeholder="Enter your email"
        value={formData.email}
        onChange={handleChange}
        error={
          errors.email ||
          (error && error.toLowerCase().includes("email") ? error : "")
        }
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

      {error && !error.toLowerCase().includes("email") && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      <div className="pt-1">
        <Button label="Sign In" type="submit" loading={loading} fullWidth />
      </div>
    </form>
  );
};

export default LoginForm;
