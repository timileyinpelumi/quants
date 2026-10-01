import { avatarGradient, imgSrc } from "./format";

export function Avatar({ seed, label, size = 44, image }: { seed: string; label: string; size?: number; image?: string | null }) {
  const radius = Math.round(size * 0.31);
  if (image) {
    return <img src={imgSrc(image, size)} alt="" loading="lazy" decoding="async" width={size} height={size} style={{ width: size, height: size, borderRadius: radius }} className="object-cover puff shrink-0" />;
  }
  const [a, b] = avatarGradient(seed);
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center font-display font-black text-ground puff shrink-0"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.4), background: `linear-gradient(145deg, ${a}, ${b})` }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
