import { useParams } from 'react-router-dom'

export default function StreamDetail() {
  const { id } = useParams()
  return <h1 className="text-2xl font-semibold text-white">Stream: {id}</h1>
}
