import { useParams } from 'react-router-dom'

export default function ItemDetail() {
  const { id } = useParams()
  return <h1 className="text-2xl font-semibold text-white">Item: {id}</h1>
}
