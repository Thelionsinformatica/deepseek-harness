import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import officialLogo from './assets/the-lions-logo.png'
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
    <span
      style={{ width: size, height: size }}
      className={classes}
      role="img"
      aria-label="The Lions Informática — Leon"
    >
      <img src={officialLogo} alt="" aria-hidden="true" />
    </span>
  )
}

/**
 * Render The Lions Informática with Leon as the highlighted product name.
 * @returns the Leon wordmark.
 */
export function OfficialBrandName() {
  return (
    <div className={styles.wordmark} aria-label="The Lions Informática — Leon">
      <strong className={styles.leon}>LEON</strong>
      <span className={styles.company}>
        <strong>THE LIONS</strong>
        <span>INFORMÁTICA</span>
      </span>
    </div>
  )
}
