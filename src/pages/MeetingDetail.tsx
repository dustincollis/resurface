import { useParams } from 'react-router-dom'

export default function MeetingDetail() {
  const { id } = useParams()
  return <h1 className="text-2xl font-semibold text-white">Meeting: {id}</h1>
}
