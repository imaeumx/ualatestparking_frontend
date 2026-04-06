/**
 * ReservationModal Component
 *
 * Presentational modal for reservation input.
 * Parent (ParkingManagement) owns all state and handlers.
 */
export default function ReservationModal({
    // Visibility and selection
    isOpen,
    selectedSpotsForReservation,
    isMultiSelectMode,

    // Error display
    reservationModalError,

    // Single-spot fields
    reserveStickerInput,
    setReserveStickerInput,
    reservationReasonText,
    setReservationReasonText,

    // Shared reservation fields
    reservationReasonCategory,
    setReservationReasonCategory,
    reserveDate,
    setReserveDate,
    reserveTime,
    setReserveTime,

    // Org/school fields
    reservationOrgName,
    setReservationOrgName,
    reservationEventName,
    setReservationEventName,
    reservationActivityForm,
    setReservationActivityForm,

    // Requester fields
    reservationRequesterName,
    setReservationRequesterName,
    reservationOrgPosition,
    setReservationOrgPosition,

    // Helpers and callbacks
    getValidUserStickers,
    onSubmit,
    onCancel
}) {
    // Fast exit: do not mount modal DOM when closed.
    if (!isOpen) return null;

    const isSingleSpot = selectedSpotsForReservation.size === 1;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '16px'
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: '720px',
                    background: '#ffffff',
                    borderRadius: '16px',
                    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
                    border: '1px solid #e2e8f0',
                    padding: '24px'
                }}
            >
                {/* Title switches plural form for multi-spot reservation. */}
                <h3 style={{ margin: '0 0 12px', color: '#0f172a' }}>
                    Reserve Spot{selectedSpotsForReservation.size > 1 ? 's' : ''}
                </h3>

                {/* Inline validation area from parent-side submit checks. */}
                {reservationModalError && (
                    <div
                        style={{
                            marginBottom: '12px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#b91c1c',
                            fontSize: '12px',
                            fontWeight: 700
                        }}
                    >
                        {reservationModalError}
                    </div>
                )}

                {isSingleSpot ? (
                    <>
                        {/* Single-spot mode uses sticker + simple reason fields. */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                UA Sticker ID
                            </label>
                            {(() => {
                                const singleSpotStickerOptions = getValidUserStickers();

                                if (singleSpotStickerOptions.length === 0) {
                                    return (
                                        <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 700 }}>
                                            No valid parking sticker available. Reservation is disabled.
                                        </div>
                                    );
                                }

                                if (singleSpotStickerOptions.length === 1) {
                                    return (
                                        <input
                                            type="text"
                                            value={singleSpotStickerOptions[0]}
                                            disabled
                                            style={{ background: '#f8fafc', color: '#334155' }}
                                        />
                                    );
                                }

                                return (
                                    <select
                                        value={reserveStickerInput}
                                        onChange={(e) => setReserveStickerInput(e.target.value)}
                                    >
                                        {singleSpotStickerOptions.map((stickerOption) => (
                                            <option key={stickerOption} value={stickerOption}>
                                                {stickerOption}
                                            </option>
                                        ))}
                                    </select>
                                );
                            })()}
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                Reason
                            </label>
                            <input
                                type="text"
                                value={reservationReasonText}
                                onChange={(e) => setReservationReasonText(e.target.value)}
                                placeholder="Why are you reserving this spot?"
                            />
                        </div>
                    </>
                ) : (
                    <>
                        {/* Multi-spot mode starts with category selection. */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                Reason Category
                            </label>
                            <select value={reservationReasonCategory} onChange={(e) => setReservationReasonCategory(e.target.value)}>
                                <option value="" disabled>
                                    Select reason category
                                </option>
                                <option value="Org Related Event">Org Related Event</option>
                                <option value="School Related Event">School Related Event</option>
                                <option value="Others">Others</option>
                            </select>
                        </div>

                        {/* Category-specific school fields. */}
                        {reservationReasonCategory === 'School Related Event' && (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Event Name
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationEventName}
                                            onChange={(e) => setReservationEventName(e.target.value)}
                                            placeholder="Enter event name"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Activity Form No.
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationActivityForm}
                                            onChange={(e) => setReservationActivityForm(e.target.value)}
                                            placeholder="Enter activity form number"
                                        />
                                    </div>
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        Name of Person Requesting Reservation
                                    </label>
                                    <input
                                        type="text"
                                        value={reservationRequesterName}
                                        onChange={(e) => setReservationRequesterName(e.target.value)}
                                        placeholder="Enter full name"
                                    />
                                </div>
                            </>
                        )}

                        {/* Category-specific organization fields. */}
                        {reservationReasonCategory === 'Org Related Event' && (
                            <>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        Org Name
                                    </label>
                                    <input
                                        type="text"
                                        value={reservationOrgName}
                                        onChange={(e) => setReservationOrgName(e.target.value)}
                                        placeholder="Organization name"
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Event Name
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationEventName}
                                            onChange={(e) => setReservationEventName(e.target.value)}
                                            placeholder="Enter event name"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Activity Form
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationActivityForm}
                                            onChange={(e) => setReservationActivityForm(e.target.value)}
                                            placeholder="Activity / event name"
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Name of Person Requesting Reservation
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationRequesterName}
                                            onChange={(e) => setReservationRequesterName(e.target.value)}
                                            placeholder="Full name"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Org Position
                                        </label>
                                        <input
                                            type="text"
                                            value={reservationOrgPosition}
                                            onChange={(e) => setReservationOrgPosition(e.target.value)}
                                            placeholder="Position"
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Generic requester field for non-org, non-school category. */}
                        {reservationReasonCategory === 'Others' && (
                            <div style={{ marginBottom: '12px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                    Name of Person Requesting Reservation
                                </label>
                                <input
                                    type="text"
                                    value={reservationRequesterName}
                                    onChange={(e) => setReservationRequesterName(e.target.value)}
                                    placeholder="Enter full name"
                                />
                            </div>
                        )}

                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                Detailed Reason
                            </label>
                            <textarea
                                value={reservationReasonText}
                                onChange={(e) => setReservationReasonText(e.target.value)}
                                placeholder="Write the full reservation reason here..."
                                rows={4}
                                style={{
                                    width: '100%',
                                    maxWidth: '100%',
                                    boxSizing: 'border-box',
                                    resize: 'vertical',
                                    overflowY: 'auto'
                                }}
                            />
                        </div>
                    </>
                )}

                {/* Date/time is required for both single and multi spot reservations. */}
                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        Date and Time
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Calendar Date</div>
                            <input
                                type="date"
                                value={reserveDate}
                                onChange={(e) => setReserveDate(e.target.value)}
                                style={{
                                    cursor: 'pointer',
                                    background: '#f8fafc',
                                    border: '1px solid #94a3b8',
                                    color: '#0f172a',
                                    colorScheme: 'light'
                                }}
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Time</div>
                            <input
                                type="time"
                                value={reserveTime}
                                onChange={(e) => setReserveTime(e.target.value)}
                                style={{
                                    cursor: 'pointer',
                                    background: '#f8fafc',
                                    border: '1px solid #94a3b8',
                                    color: '#0f172a',
                                    colorScheme: 'light'
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Selected spot summary appears only when multi-select mode is active. */}
                {isMultiSelectMode && (
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
                        Selected spots: {Array.from(selectedSpotsForReservation).sort((a, b) => a - b).join(', ')}
                    </div>
                )}

                {/* Action row delegates submit/cancel to parent handlers. */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        type="button"
                        className="btn-green"
                        onClick={onSubmit}
                        style={{ flex: 1, marginTop: 0 }}
                    >
                        Submit Reservation
                    </button>
                    <button
                        type="button"
                        className="btn-gray"
                        onClick={onCancel}
                        style={{ flex: 1, marginTop: 0 }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
