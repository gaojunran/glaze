type RemoveButtonProps = {
  onClick: () => void
}

export default function RemoveButton(props: RemoveButtonProps) {
  return (
    <button class="remove" onClick={props.onClick}>
      x
    </button>
  )
}
