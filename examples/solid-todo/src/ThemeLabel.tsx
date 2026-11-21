import { useContext } from 'solid-js'

type ThemeLabelProps = {
  theme: unknown
}

export default function ThemeLabel(props: ThemeLabelProps) {
  const theme = useContext(props.theme as never)
  return <text class="theme-label">{String(theme)}</text>
}
