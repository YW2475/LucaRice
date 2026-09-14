import type { IconProps } from './icons/props.ts'

/**
 * Render the LucaRice logo.
 * @param props.size - square edge in px.
 * @param props.className - extra class for layout placement.
 * @returns the decorative LucaRice logo image.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/lucarice-logo.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
    />
  )
}
