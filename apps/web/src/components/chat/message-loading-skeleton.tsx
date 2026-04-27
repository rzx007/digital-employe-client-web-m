import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message"
import { Skeleton } from "@workspace/ui/components/skeleton"

export function MessageLoadingSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <Message from="user" className="mx-auto max-w-4xl">
        <MessageContent>
          <div className="space-y-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </MessageContent>
      </Message>
      <Message from="assistant" className="mx-auto max-w-4xl">
        <MessageContent>
          <div className="space-y-2">
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-40" />
          </div>
        </MessageContent>
      </Message>
      <Message from="assistant" className="mx-auto max-w-4xl">
        <MessageContent>
          <div className="space-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-3 w-36" />
          </div>
        </MessageContent>
      </Message>
    </div>
  )
}
