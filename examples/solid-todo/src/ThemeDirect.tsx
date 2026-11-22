import { useContext } from 'solid-js'

type ThemeDirectProps = {
  theme: unknown
}

export default function ThemeDirect(props: ThemeDirectProps) {
  const theme = useContext(props.theme as never)
  return <text class="theme-direct">{String(theme)}</text>
}
