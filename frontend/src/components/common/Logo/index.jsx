import logo from "../../../assets/logo.png";

const Logo = ({ size = "md" }) => {
  const sizes = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-24 h-24",
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={logo}
        alt="SOCIO.LK POS Logo"
        className={`${sizes[size]} object-contain`}
      />
      <div className="text-center">
        <h1
          className="font-semibold tracking-widest text-base"
          style={{ color: "#0f172a" }}
        >
          SOCIO.LK
        </h1>
        <p
          className="text-xs tracking-[0.28em] uppercase font-medium"
          style={{ color: "#0ea5e9" }}
        >
          Point of Sale
        </p>
      </div>
    </div>
  );
};

export default Logo;
