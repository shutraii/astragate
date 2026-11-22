import Dashboard from '../../../src/App'

export default async function ConnectTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>
}) {
  const { topicId } = await params
  return <Dashboard initialTopicId={topicId} />
}
