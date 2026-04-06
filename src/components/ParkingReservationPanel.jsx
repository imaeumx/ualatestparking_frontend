import { useState } from 'react';

/**
 * ParkingReservationPanel Component
 * 
 * Read-only dashboard section displaying user's reservation history and parking status.
 * Features:
 * 1. Summary cards: count of pending reservations, occupied parking slots
 * 2. Reservation history table: paginated list of user's past/current/future reservations
 * 3. Pagination controls: navigate through pages of reservation history
 * 
 * This component is stateless except for pagination page number.
 * All user data (reservations, slots) passed from parent (UserDashboard).
 */
export default function ParkingReservationPanel({
    userReservations, // array: all reservations by current user (any status: pending/approved/expired/cancelled)
    parkingSlots, // array: all parking slots in system with their current status
    totalParkingSlots // number: total count of slots across all parking areas (180)
}) {
    // ============ LOCAL STATE: PAGINATION ============
    // Tracks which page of reservation history table user is viewing (1-indexed)
    const [userReservationsPage, setUserReservationsPage] = useState(1);

    // ============ PAGINATION CONFIGURATION ============
    // Number of reservation rows to display per page (keeps table from getting too long)
    const USER_RESERVATIONS_PAGE_SIZE = 10;
    
    // ============ COMPUTED STATS FOR DASHBOARD CARDS ============
    // Count pending reservations (waiting for admin approval)
    const pendingReservationsCount = userReservations.filter(res => res.status === 'pending').length;
    // Count currently occupied parking slots (any sticker parked there)
    const occupiedCount = parkingSlots.filter(slot => slot.status === 'occupied').length;

    // ============ PAGINATION MATH ============
    // Calculate total number of pages needed to display all reservations
    // Math.max(1, ...) ensures at least 1 page even if userReservations is empty
    const userReservationsTotalPages = Math.max(1, Math.ceil(userReservations.length / USER_RESERVATIONS_PAGE_SIZE));
    // Guard against invalid page numbers: ensure current page <= total pages
    // Example: if user was on page 5, but filters now show only 2 pages → snap to page 2
    const safeUserReservationsPage = Math.min(userReservationsPage, userReservationsTotalPages);
    // Extract the 10 reservations for current page using array.slice()
    // Formula: slice from (pageNum - 1) * pageSize to (pageNum - 1) * pageSize + pageSize
    // Example: page 2 with pageSize=10 → slice(10, 20)
    const paginatedUserReservations = userReservations.slice(
        (safeUserReservationsPage - 1) * USER_RESERVATIONS_PAGE_SIZE,
        (safeUserReservationsPage - 1) * USER_RESERVATIONS_PAGE_SIZE + USER_RESERVATIONS_PAGE_SIZE
    );

    return (
        <>
            <div className="panel">
                <h3 className="panel-title">Dashboard</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                    <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '12px' }}>
                        <div style={{ color: '#4c1d95', fontSize: '12px', fontWeight: 700 }}>Pending Reservations</div>
                        <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#1e1b4b' }}>{pendingReservationsCount}</div>
                    </div>
                    <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '10px', padding: '12px' }}>
                        <div style={{ color: '#166534', fontSize: '12px', fontWeight: 700 }}>Occupied Slots</div>
                        <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#14532d' }}>{occupiedCount} / {totalParkingSlots}</div>
                    </div>
                </div>
            </div>

            <div className="panel">
                <h3 className="panel-title">My Parking Reservations</h3>
                {userReservations.length === 0 ? (
                    <p style={{ color: '#64748b' }}>You haven't made any reservations yet.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9' }}>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Spots</th>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reason</th>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reserved For</th>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Submitted</th>
                                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Admin Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedUserReservations.map((res) => {
                                    const statusColor =
                                        res.status === 'approved' ? '#10b981' :
                                        res.status === 'denied' ? '#ef4444' :
                                        res.status === 'pending' ? '#f59e0b' :
                                        '#6b7280';
                                    const statusBg =
                                        res.status === 'approved' ? '#d1fae5' :
                                        res.status === 'denied' ? '#fee2e2' :
                                        res.status === 'pending' ? '#fef3c7' :
                                        '#f3f4f6';

                                    return (
                                        <tr key={res.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>
                                                {Array.isArray(res.reserved_spots)
                                                    ? res.reserved_spots.join(', ')
                                                    : JSON.parse(res.reserved_spots || '[]').join(', ')}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>{res.reservation_reason}</td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>
                                                {new Date(res.reserved_for_datetime).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '4px 8px',
                                                    background: statusBg,
                                                    color: statusColor,
                                                    borderRadius: '4px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {res.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>
                                                {new Date(res.created_at).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px', color: '#64748b' }}>
                                                {res.admin_notes || '---'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {userReservations.length > USER_RESERVATIONS_PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <button
                            className="btn-gray slim"
                            onClick={() => setUserReservationsPage((prev) => Math.max(1, prev - 1))}
                            disabled={safeUserReservationsPage === 1}
                            style={{ marginTop: 0, opacity: safeUserReservationsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Prev
                        </button>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '90px', textAlign: 'center' }}>
                            Page {safeUserReservationsPage} of {userReservationsTotalPages}
                        </span>
                        <button
                            className="btn-gray slim"
                            onClick={() => setUserReservationsPage((prev) => Math.min(userReservationsTotalPages, prev + 1))}
                            disabled={safeUserReservationsPage === userReservationsTotalPages}
                            style={{ marginTop: 0, opacity: safeUserReservationsPage === userReservationsTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
