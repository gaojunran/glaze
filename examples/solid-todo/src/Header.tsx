type HeaderProps = {
  title: string
}

export default function Header(props: HeaderProps) {
  return <text class="title">{props.title}</text>
}
