type BadgeProps = {
  label: string
}

export default function Badge(props: BadgeProps) {
  return <text class="badge">{props.label}</text>
}
