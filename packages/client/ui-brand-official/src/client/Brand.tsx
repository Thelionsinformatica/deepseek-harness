import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import styles from './Brand.module.css'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the Leon lion mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the The Lions Informática lion mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  const classes = className === undefined ? styles.mark : `${styles.mark} ${className}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={classes}
      role="img"
      aria-label="The Lions Informática — Leon"
    >
      <path
        fill="currentColor"
        d="M16 1.6 20 4l4.7-.5.7 4.3 3.7 2.6-2 4.1 1.3 4-3.5 2.7-.2 4.8-4.7.7L16 30.4l-4.1-3.6-4.7-.7-.2-4.8-3.5-2.7 1.3-4-2-4.1 3.7-2.6.7-4.3L12 4l4-2.4Z"
      />
      <path
        className={styles.face}
        d="M10.2 10.4 16 7.5l5.8 2.9-.9 8.7L16 24l-4.9-4.9-.9-8.7Zm2.3 3.1 2.2 1.1-.7 1.5-2.2-1.1.7-1.5Zm7 0 .7 1.5-2.2 1.1-.7-1.5 2.2-1.1ZM14 18.2h4L16 21l-2-2.8Z"
      />
    </svg>
  )
}

/**
 * Render The Lions Informática with Leon as the highlighted product name.
 * @returns the Leon wordmark.
 */
export function OfficialBrandName() {
  return (
    <div className={styles.wordmark} aria-label="The Lions Informática — Leon">
      <span className={styles.company}>
        <strong>THE LIONS</strong>
        <span>INFORMÁTICA</span>
      </span>
      <strong className={styles.leon}>LEON</strong>
    </div>
  )
}
