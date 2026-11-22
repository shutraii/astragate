export type DeliveryStatus = 'delivered' | 'failed' | 'replayed'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved'

export interface PulseEvent {
  event_id: string
  topic_id: string
  timestamp: string
  change_type: string
  title: string
  summary: string
  verified: boolean
  citations: string[]
  approval_status: ApprovalStatus
  delivery_status: DeliveryStatus
  score?: number
  category?: string
}
