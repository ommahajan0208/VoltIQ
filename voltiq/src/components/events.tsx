"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CandidateEvent } from "@/lib/types";
import { number, sourceLabel } from "@/lib/time";
import { useView } from "@/lib/state";
import { Badge } from "./ui";
export function EventTable({
  events,
  onSelect,
  selected,
}: {
  events: CandidateEvent[];
  onSelect?: (id: string) => void;
  selected?: string;
}) {
  const { href } = useView();
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Start · source time</th>
            <th>Duration</th>
            <th>Direction</th>
            <th>Peak score</th>
            <th>Above reference</th>
            <th>Review</th>
            <th>
              <span className="sr-only">Open detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className={selected === event.id ? "selected-row" : ""}
            >
              <td>
                {onSelect ? (
                  <button
                    className="table-link"
                    onClick={() => onSelect(event.id)}
                  >
                    {sourceLabel(event.start)}
                  </button>
                ) : (
                  <Link
                    className="table-link"
                    href={href(`/anomalies/${event.id}`)}
                  >
                    {sourceLabel(event.start)}
                  </Link>
                )}
                {((event.visible_start &&
                  event.visible_start !== event.start) ||
                  (event.visible_end && event.visible_end !== event.end)) && (
                  <small className="block muted">
                    Intersects filter · whole-event facts
                  </small>
                )}
              </td>
              <td>{event.duration_minutes} min</td>
              <td>
                <Badge tone="amber">{event.direction}</Badge>
              </td>
              <td>
                {number(event.peak_score)} <small>{event.score_unit}</small>
              </td>
              <td>
                {number(event.estimated_above_reference_kwh)} <small>kWh</small>
              </td>
              <td>
                <span className="review-status">
                  {event.review.status.replaceAll("_", " ")}
                </span>
              </td>
              <td>
                <Link
                  className="icon-button"
                  aria-label={`Open event at ${sourceLabel(event.start)}`}
                  href={href(`/anomalies/${event.id}`)}
                >
                  <ArrowUpRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
