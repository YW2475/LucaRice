import type { IconProps } from './icons/props.ts'
import css from './BrandWordmark.module.css'

/**
 * Render the LucaRice logo and wordmark.
 * @param props.size - logo height in px.
 * @param props.className - extra class for layout placement.
 * @returns the decorative LucaRice wordmark.
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: size }}
    >
      <img src="/lucarice-logo.png" width={size} height={size} alt="" />
      <span style={{ fontSize: size * 0.82, lineHeight: 1, fontWeight: 600 }}>LucaRice</span>
      <span className={css.university}>湖南大学</span>
    </span>
  )
}
