import logo from "../../../assets/logo.png";

const Logo = ({ size = "md" }) => {
  const sizes = {
    sm: "w-10 h-10",
    md: "w-16 h-16",
    lg: "w-24 h-24",
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Logo Image */}
      <img
        src={logo}
        alt="SOCIO.LK POS Logo"
        className={`${sizes[size]} object-contain`}
      />

      {/* System Name */}
      <div className="text-center">
        <h1 className="text-white font-bold tracking-widest text-xl">
          SOCIO.LK
        </h1>
        <p className="text-brand-accent text-xs tracking-[0.3em] uppercase">
          Point of Sale
        </p>
      </div>
    </div>
  );
};

export default Logo;
