import { useState, useEffect } from 'react';
import { usePopup } from './PopupContext';
import axios from 'axios';
import ParkingReservationPanel from './ParkingReservationPanel';
import ReservationModal from './ReservationModal';
import StickerManagement from './StickerManagement';
import { encryptDES } from '../utils/desCrypto';
import API_BASE_URL from '../config/api';

/**
 * ParkingManagement Component
 * Handles parking slots, reservations, and parking operations
 */
export default function ParkingManagement({
    user,
    parkingSlots,
    setParkingSlots,
    userReservations,
    records,
    TOTAL_PARKING_SLOTS,
    parentActiveTab,
    setParentActiveTab,
    paymentMethods,
    displayFullName,
    decryptData,
    fetchUserRecords,
    getValidUserStickers,
    getPlateFromSticker,
    getReservationInfo,
    formatDateTime,
    getSlotStatusText,
    getSlotTooltipText,
    fetchUserReservations
}) {
    const { showError, showSuccess, showInfo } = usePopup();
    
    // ============ PARKING SLOT SELECTION STATE ============
    // Purpose: Track user's current spot/area selection and minimal form inputs for parking
    const [activeTab, setActiveTab] = useState('dashboard'); // Currently visible tab: 'dashboard' = parking overview
    const [selectedParkingSlotId, setSelectedParkingSlotId] = useState(null); // Clicked slot ID (1-179) or null = nothing selected
    const [selectedParkingAreaName, setSelectedParkingAreaName] = useState('Old Parking Space'); // Active lot: 'Old Parking Space' | 'Vertical Parking Space' | 'New Parking Space'
    const [showParkForSelectedSpot, setShowParkForSelectedSpot] = useState(false); // Toggle: show "Park Vehicle" form for selected slot?
    const [parkStickerInput, setParkStickerInput] = useState(''); // Parking form: user enters their UA sticker ID (e.g., "UA123456")
    const [parkPlateInput, setParkPlateInput] = useState(''); // Parking form: user enters vehicle plate number (e.g., "ABC1234")
    
    // ============ RESERVATION MULTI-SELECT STATE ============
    // Purpose: Enable user to click multiple parking spots and submit one multi-spot reservation
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false); // Toggle: when true, user can click multiple slots; when false, single-click selection only
    const [selectedSpotsForReservation, setSelectedSpotsForReservation] = useState(new Set()); // Set of spot IDs user selected for this reservation (e.g., {5, 12, 18})
    const [reservationSelectionOrder, setReservationSelectionOrder] = useState([]); // Array tracking click order (supports "undo last selection" feature)
    const [showReservationModal, setShowReservationModal] = useState(false); // Toggle: display the Reservation Modal form overlay?
    const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false); // Toggle: display "Confirm Checkout" dialog?
    const [leaveConfirmSlotId, setLeaveConfirmSlotId] = useState(null); // Slot ID awaiting checkout confirmation (null after dialog closes)
    
    // ============ RESERVATION FORM FIELD STATE ============
    // Purpose: Store all user inputs needed for single or multi-spot reservation submission
    const [reserveStickerInput, setReserveStickerInput] = useState(''); // Single-spot only: user selects which UA sticker to use
    const [reservePlateInput, setReservePlateInput] = useState(''); // Multi-spot only: guest plate number for the reservation
    const [reserveDate, setReserveDate] = useState(''); // Reservation date (format: "YYYY-MM-DD")
    const [reserveTime, setReserveTime] = useState(''); // Reservation time (format: "HH:MM", 24-hour)
    const [reservationReasonText, setReservationReasonText] = useState(''); // Single-spot: short reason | Multi-spot: detailed reason/description
    const [reservationReasonCategory, setReservationReasonCategory] = useState(''); // Multi-spot only: dropdown choice ("Org Related Event" | "School Related Event" | "Others")
    const [reservationOrgName, setReservationOrgName] = useState(''); // Multi-spot, org events only: name of organization requesting slots
    const [reservationEventName, setReservationEventName] = useState(''); // Multi-spot, org/school events: name of event requiring parking
    const [reservationActivityForm, setReservationActivityForm] = useState(''); // Multi-spot, org/school events: activity form number for university records
    const [reservationRequesterName, setReservationRequesterName] = useState(''); // Multi-spot all categories: full name of person requesting the reservation
    const [reservationOrgPosition, setReservationOrgPosition] = useState(''); // Multi-spot, org events only: position held by requester in organization
    const [reservationModalError, setReservationModalError] = useState(''); // Error message displayed in modal (cleared on each submit attempt)
    const [approvedMapReservations, setApprovedMapReservations] = useState([]);
    
    // ============ PARKING AREAS CONFIGURATION ============
    // Static layout definition for all three campus parking lots.
    // Each area defines grid dimensions (rows, cols) for rendering and slot ID ranges.
    // Slot IDs are sequential: Old (1-40) → Vertical (41-90) → New (91-180)
    const parkingAreas = [
        // Old Parking Space: 40 total slots arranged in 4 rows of 10 columns
        { name: 'Old Parking Space', startId: 1, slotCount: 40, slotsPerRow: 10, totalRows: 4 },
        // Vertical Parking Space: 50 total slots arranged in 5 rows of 10 columns
        { name: 'Vertical Parking Space', startId: 41, slotCount: 50, slotsPerRow: 10, totalRows: 5 },
        // New Parking Space: 90 total slots arranged in 6 rows of 15 columns
        { name: 'New Parking Space', startId: 91, slotCount: 90, slotsPerRow: 15, totalRows: 6 }
    ];

    const parseReservationSpots = (reservation) => {
        if (!reservation) return [];
        if (Array.isArray(reservation.reserved_spots)) {
            return reservation.reserved_spots
                .map((spot) => parseInt(spot, 10))
                .filter((spot) => !Number.isNaN(spot));
        }

        try {
            // Backend may return reserved_spots as a JSON string; normalize both shapes.
            const parsed = JSON.parse(reservation.reserved_spots || '[]');
            return Array.isArray(parsed)
                ? parsed.map((spot) => parseInt(spot, 10)).filter((spot) => !Number.isNaN(spot))
                : [];
        } catch {
            return [];
        }
    };

    const getSpotLabel = (spotId) => {
        const numericSpotId = parseInt(spotId, 10);
        if (Number.isNaN(numericSpotId)) return '---';

        const area = parkingAreas.find((item) => numericSpotId >= item.startId && numericSpotId < item.startId + item.slotCount);
        if (!area) return String(numericSpotId);

        const localIndex = numericSpotId - area.startId;
        const row = Math.floor(localIndex / area.slotsPerRow);
        const col = (localIndex % area.slotsPerRow) + 1;
        const rowLetter = String.fromCharCode(65 + row);
        return `${rowLetter}${col}`;
    };

    const formatReservationTimeOnly = (value) => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '---';
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    const formatReservationDateOnly = (value) => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '---';
        return d.toLocaleDateString();
    };

    const getReservationUserDisplay = (rawUsername) => {
        const username = (rawUsername || '').trim();
        if (!username) return '---';

        const currentUsername = (user?.username || '').trim();
        if (currentUsername && username.toLowerCase() === currentUsername.toLowerCase()) {
            return username;
        }

        try {
            return encryptDES(username);
        } catch {
            return '***';
        }
    };

    const getReservationInfoFromDateTime = (dateTimeValue) => {
        const reservedAt = new Date(dateTimeValue || '');
        if (Number.isNaN(reservedAt.getTime())) return null;

        const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
        const now = new Date();
        return {
            reservedAt,
            graceEnd,
            isUpcoming: now < reservedAt,
            isActive: now >= reservedAt && now <= graceEnd,
            isOverdue: now > graceEnd
        };
    };

    const getReservationForSlot = (slot) => {
        if (!slot?.id) return null;

        const approvedReservations = Array.isArray(approvedMapReservations) && approvedMapReservations.length > 0
            ? approvedMapReservations.filter((reservation) => (reservation?.status || '').toLowerCase() === 'approved')
            : (Array.isArray(userReservations)
                ? userReservations.filter((reservation) => (reservation?.status || '').toLowerCase() === 'approved')
                : []);

        const matchingReservations = approvedReservations.filter((reservation) => {
            const spots = parseReservationSpots(reservation);
            if (!spots.includes(slot.id)) return false;
            const reservationTime = new Date(reservation.reserved_for_datetime || '').getTime();
            return !Number.isNaN(reservationTime);
        });

        if (matchingReservations.length === 0) return null;

        const getPriority = (reservation) => {
            const info = getReservationInfoFromDateTime(reservation.reserved_for_datetime);
            if (!info) return { rank: -1, timeValue: 0 };
            if (info.isOverdue) return { rank: 3, timeValue: info.reservedAt.getTime() };
            if (info.isActive) return { rank: 2, timeValue: info.reservedAt.getTime() };
            return { rank: 1, timeValue: -info.reservedAt.getTime() };
        };

        return matchingReservations.reduce((best, current) => {
            if (!best) return current;
            const bestPriority = getPriority(best);
            const currentPriority = getPriority(current);
            if (currentPriority.rank > bestPriority.rank) return current;
            if (currentPriority.rank < bestPriority.rank) return best;
            return currentPriority.timeValue > bestPriority.timeValue ? current : best;
        }, null);
    };

    const getEffectiveReservationContext = (slot) => {
        const reservation = getReservationForSlot(slot);
        if (reservation) {
            return {
                reservation,
                reservationInfo: getReservationInfoFromDateTime(reservation.reserved_for_datetime),
                reservedStickerId: (reservation.sticker_id || '').trim().toUpperCase()
            };
        }

        return {
            reservation: null,
            reservationInfo: getReservationInfo(slot),
            reservedStickerId: (slot?.reservedStickerId || '').trim().toUpperCase()
        };
    };

    const formatReservationSpotList = (reservation) => {
        const spots = parseReservationSpots(reservation);
        if (spots.length === 0) return '---';

        return spots.join(', ');
    };

    useEffect(() => {
        const fetchApprovedReservationsForMap = async () => {
            const authToken = user?.authToken || '';
            if (!authToken) {
                setApprovedMapReservations([]);
                return;
            }

            try {
                // Pulling approved reservations keeps the map synchronized across all users.
                const response = await axios.get(`${API_BASE_URL}/approved-reservations-map/`, {
                    params: {
                        auth_token: authToken
                    }
                });

                setApprovedMapReservations(Array.isArray(response.data) ? response.data : []);
            } catch {
                setApprovedMapReservations([]);
            }
        };

        fetchApprovedReservationsForMap();
        const refreshTimer = setInterval(fetchApprovedReservationsForMap, 15000);
        return () => clearInterval(refreshTimer);
    }, [user?.authToken]);

    // ============ EFFECT: AUTO-RESET FORMS ON SELECTION CHANGE ============
    // Trigger: User clicks a different parking slot OR switches to a different parking lot.
    // Purpose: Clear form inputs to prevent accidentally parking in the wrong slot or 
    //          with stale sticker/plate data from the previous selection.
    // Example: User parks in slot 5, then clicks slot 10 → all forms automatically clear.
    useEffect(() => {
        const resetFormInputs = () => {
            setShowParkForSelectedSpot(false); // Hide the "Park Vehicle" form modal
            setParkStickerInput(''); // Clear the parking sticker ID field
            setParkPlateInput(''); // Clear the parking plate number field
            setReserveStickerInput(''); // Clear the reservation sticker ID field
            setReserveDate(''); // Clear the reservation date field
            setReserveTime(''); // Clear the reservation time field
            // NOTE: Category and org fields NOT cleared → preserves context for multi-spot reservation flow
        };
        resetFormInputs();
    }, [selectedParkingSlotId, selectedParkingAreaName]);

    // ============ FUNCTION: GET SLOT COLOR/STYLING ============
    // Purpose: Determine visual appearance (colors, gradient, shadow) of a parking slot button based on its state.
    // Called once per slot during render. Returns CSS style object: {background, borderColor, color, shadow}.
    // Priority order: Selected > Occupied > Reserved > Available
    const getParkingSlotFill = (slot) => {
        // PRIORITY 1: Selected slot – highlight in bright teal if user just clicked it
        if (selectedParkingSlotId === slot.id) {
            return {
                background: 'linear-gradient(180deg, #0f766e 0%, #14b8a6 100%)', // Teal gradient: dark top → light bottom
                borderColor: '#0f766e', // Dark teal border
                color: '#ffffff', // White text for contrast
                shadow: '0 10px 24px rgba(20, 184, 166, 0.28)' // Teal glow effect to draw attention
            };
        }

        // PRIORITY 2: Occupied slot – red gradient shows someone is parked there
        if (slot.status === 'occupied') {
            return {
                background: 'linear-gradient(180deg, #fee2e2 0%, #fecaca 100%)', // Light red gradient: pale → slightly darker
                borderColor: '#ef4444', // Red border
                color: '#991b1b', // Dark red text
                shadow: '0 8px 18px rgba(239, 68, 68, 0.18)' // Light red shadow
            };
        }

        const { reservationInfo } = getEffectiveReservationContext(slot);
        if (reservationInfo) {
            if (reservationInfo.isUpcoming) {
                return {
                    background: 'linear-gradient(180deg, #f3f4f6 0%, #e5e7eb 100%)',
                    borderColor: '#9ca3af',
                    color: '#374151',
                    shadow: '0 8px 18px rgba(156, 163, 175, 0.18)'
                };
            }

            return {
                background: reservationInfo.isOverdue
                    ? 'linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)'
                    : 'linear-gradient(180deg, #fef9c3 0%, #fde68a 100%)',
                borderColor: reservationInfo.isOverdue ? '#d97706' : '#ca8a04',
                color: '#78350f',
                shadow: '0 8px 18px rgba(202, 138, 4, 0.18)'
            };
        }

        return {
            background: 'linear-gradient(180deg, #f3f4f6 0%, #e5e7eb 100%)',
            borderColor: '#9ca3af',
            color: '#374151',
            shadow: '0 8px 18px rgba(156, 163, 175, 0.18)'
        };
    };

    // Returns the full slot object for the currently selected slot id.
    // We return null (not undefined) so calling code can do simple null checks.
    const getSelectedParkingSlot = () => parkingSlots.find(slot => slot.id === selectedParkingSlotId) || null;

    // Checks ownership: can the logged-in user manage/check out this occupied slot?
    // Rule used here: if the slot sticker matches any sticker in this user's records,
    // then this slot is considered owned by the current user.
    const isCurrentUserSpot = (slot) => {
        // Guard clause: no slot or no sticker means no ownership match is possible.
        if (!slot || !slot.stickerId) return false;

        // Normalize for safe comparison (ignore spaces and letter case).
        const normalizedSlotSticker = (slot.stickerId || '').trim().toUpperCase();

        // Empty sticker after normalization is treated as invalid/unowned.
        if (!normalizedSlotSticker) return false;

        // Search through the user's application records and check if at least one
        // approved/known sticker id matches the sticker currently parked in this slot.
        return records.some((record) => {
            const recordSticker = (record.sticker_id || '').trim().toUpperCase();
            return recordSticker && recordSticker === normalizedSlotSticker;
        });
    };

    // Special case for multi-reservation parking where a guest plate can park.
    // In this flow, reservedStickerId uses 'N/A' instead of a specific user sticker.
    const isGuestReservationWindow = (slot) => {
        const { reservationInfo, reservedStickerId } = getEffectiveReservationContext(slot);
        const reservedSticker = reservedStickerId;
        return !!reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedSticker === 'N/A';
    };

    const addUserParkingLog = (eventType, slot, notes = '') => {
        if (!slot || !slot.id) return;

        const firstName = (user?.firstName || user?.first_name || '').trim();
        const lastName = (user?.lastName || user?.last_name || '').trim();
        const actorName = `${firstName} ${lastName}`.trim() || user?.username || 'user';
        const existingLogsRaw = JSON.parse(localStorage.getItem('parkingLogs') || '[]');
        const existingLogs = Array.isArray(existingLogsRaw) ? existingLogsRaw : [];

        const nextLog = {
            id: `${Date.now()}-${slot.id}-${eventType}`,
            timestamp: new Date().toISOString(),
            eventType,
            slotId: slot.id,
            plateNumber: slot.plateNumber || '',
            stickerId: slot.stickerId || '',
            actor: actorName,
            notes
        };

        const updatedLogs = [nextLog, ...existingLogs].slice(0, 300);
        localStorage.setItem('parkingLogs', JSON.stringify(updatedLogs));
    };

    // Core parking write operation:
    // 1) validate sticker
    // 2) validate reservation conflict
    // 3) update slot state + persist to localStorage
    const parkVehicle = (slotId, plateNumber, stickerId) => {
        const normalizedStickerId = (stickerId || '').trim().toUpperCase();
        const currentStickers = getValidUserStickers();
        if (!currentStickers.includes(normalizedStickerId)) {
            showError(`Invalid sticker ID. Valid approved stickers: ${currentStickers.join(', ') || 'None available - please contact admin'}`);
            return false;
        }

        const alreadyParkedSlot = parkingSlots.find(slot =>
            slot.status === 'occupied' &&
            (slot.stickerId || '').trim().toUpperCase() === normalizedStickerId
        );
        if (alreadyParkedSlot) {
            showError(`Sticker ${normalizedStickerId} is already parked in slot ${alreadyParkedSlot.id}.`);
            return false;
        }

        const targetSlot = parkingSlots.find(slot => slot.id === slotId);
        const { reservationInfo, reservedStickerId } = getEffectiveReservationContext(targetSlot);
        if (reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedStickerId && reservedStickerId !== normalizedStickerId) {
            showError('This spot is reserved right now. Please choose another spot.');
            return false;
        }

        const updatedSlots = parkingSlots.map(slot =>
            slot.id === slotId
                ? {
                    ...slot,
                    status: 'occupied',
                    plateNumber,
                    stickerId: normalizedStickerId,
                    entryTime: new Date().toISOString(),
                    reservedFor: null,
                    reservedStickerId: ''
                }
                : slot
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
        const occupiedSlot = updatedSlots.find((slot) => slot.id === slotId);
        if (occupiedSlot) {
            addUserParkingLog('park', occupiedSlot, 'Parked by user self-service action.');
        }
        showSuccess(`Vehicle ${plateNumber} parked in slot ${slotId}`);
        return true;
    };

    // UI-level parking handler for the currently selected slot.
    // This function decides whether to use guest-flow or sticker-flow parking.
    const handleParkSelectedSpot = () => {
        const selectedSlot = getSelectedParkingSlot();

        if (!selectedSlot) {
            showError('Please select a parking spot first.');
            return;
        }

        if (selectedSlot.status !== 'available') {
            showError('Selected spot is already occupied.');
            return;
        }

        const { reservationInfo, reservedStickerId } = getEffectiveReservationContext(selectedSlot);

        // Guest flow: used for multi-spot reservations tagged as N/A sticker.
        if (isGuestReservationWindow(selectedSlot)) {
            const guestPlateNumber = (parkPlateInput || '').trim().toUpperCase();
            if (!guestPlateNumber) {
                showError('Plate number is required for this multiple reservation parking.');
                return;
            }

            const updatedSlots = parkingSlots.map((slot) =>
                slot.id === selectedSlot.id
                    ? {
                        ...slot,
                        status: 'occupied',
                        plateNumber: guestPlateNumber,
                        stickerId: 'GUEST',
                        entryTime: new Date().toISOString(),
                        reservedFor: null,
                        reservedStickerId: ''
                    }
                    : slot
            );
            setParkingSlots(updatedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
            const occupiedSlot = updatedSlots.find((slot) => slot.id === selectedSlot.id);
            if (occupiedSlot) {
                addUserParkingLog('park', occupiedSlot, 'Parked by user self-service action (guest/event reservation).');
            }
            setParkStickerInput('');
            setParkPlateInput('');
            setShowParkForSelectedSpot(false);
            showSuccess(`Vehicle ${guestPlateNumber} parked in slot ${selectedSlot.id}`);
            return;
        }

        if (!parkStickerInput.trim()) {
            showError('Please enter your UA sticker ID.');
            return;
        }

        // Normalize user input before validation and matching.
        const sticker = parkStickerInput.trim().toUpperCase();
        const reservedSticker = reservedStickerId;

        if (reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedSticker && reservedSticker !== sticker) {
            showError('This slot has an active/overdue reservation. Guard can release expired reservations after checking no-show.');
            return;
        }

        const plateNumber = getPlateFromSticker(sticker);
        if (!plateNumber) {
            showError('Invalid sticker ID or not valid for the current semester.');
            return;
        }

        if (parkVehicle(selectedSlot.id, plateNumber, sticker)) {
            setParkStickerInput('');
            setShowParkForSelectedSpot(false);
        }
    };

    // Generic checkout function.
    // Accepts either slot number (e.g., "12") or plate number (e.g., "ABC1234").
    const leaveParking = (identifier) => {
        const trimmed = (identifier || '').trim();
        const normalized = trimmed.toUpperCase();

        // Resolve input to one concrete occupied slot.
        let slot = null;
        if (/^\d+$/.test(trimmed)) {
            const slotId = parseInt(trimmed, 10);
            slot = parkingSlots.find(s => s.id === slotId && s.status === 'occupied');
        } else {
            slot = parkingSlots.find(
                s => (s.plateNumber || '').trim().toUpperCase() === normalized && s.status === 'occupied'
            );
        }

        if (!slot) {
            showError('Vehicle or slot not found, or slot is already available.');
            return;
        }

        const updatedSlots = parkingSlots.map(s =>
            s.id === slot.id ? { ...s, status: 'available', plateNumber: '', stickerId: '', entryTime: null } : s
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
        addUserParkingLog('release', slot, 'Checked out by user self-service action.');
        showInfo(`Vehicle ${slot.plateNumber} left slot ${slot.id} successfully.`);
    };


    // Opens confirmation modal only when selected spot is valid and owned by current user.
    const handleLeaveSelectedSpot = () => {
        const selectedSlot = getSelectedParkingSlot();
        if (!selectedSlot) {
            showError('Please select a parking spot first.');
            return;
        }

        if (selectedSlot.status !== 'occupied') {
            showError('Selected spot is not occupied.');
            return;
        }

        if (!isCurrentUserSpot(selectedSlot)) {
            showError('You can only leave/check out your own occupied spot.');
            return;
        }

        setLeaveConfirmSlotId(selectedSlot.id);
        setShowLeaveConfirmModal(true);
    };

    // Final confirmation action for checkout modal.
    const handleConfirmLeaveSelectedSpot = () => {
        if (!leaveConfirmSlotId) {
            setShowLeaveConfirmModal(false);
            return;
        }

        leaveParking(String(leaveConfirmSlotId));
        setSelectedParkingSlotId(null);
        setLeaveConfirmSlotId(null);
        setShowLeaveConfirmModal(false);
    };

    // Enables/disables multi-select mode for selecting several spots in one reservation.
    const handleToggleMultiSelectMode = () => {
        setIsMultiSelectMode((prevMode) => {
            const nextMode = !prevMode;
            if (!nextMode) {
                setSelectedSpotsForReservation(new Set());
                setReservationSelectionOrder([]);
            }
            showInfo(`Select Multiple ${nextMode ? 'enabled' : 'disabled'}.`, 1000);
            return nextMode;
        });
    };

    // Removes the most recently selected spot (stack-like undo behavior).
    const handleUndoReservationSelection = () => {
        if (reservationSelectionOrder.length === 0) return;
        const lastSelectedSpot = reservationSelectionOrder[reservationSelectionOrder.length - 1];

        setSelectedSpotsForReservation((prevSelected) => {
            const nextSelected = new Set(prevSelected);
            nextSelected.delete(lastSelectedSpot);
            return nextSelected;
        });
        setReservationSelectionOrder((prevOrder) => prevOrder.slice(0, -1));
    };

    // Clears all currently selected spots for reservation.
    const handleClearReservationSelections = () => {
        setSelectedSpotsForReservation(new Set());
        setReservationSelectionOrder([]);
    };

    // Prepares and opens reservation modal based on current selection mode.
    const handleOpenReservationModal = () => {
        // If user did not multi-select, fall back to the single clicked slot.
        const fallbackSingleSpot = selectedParkingSlotId ? [selectedParkingSlotId] : [];
        const normalizedSpots = selectedSpotsForReservation.size > 0
            ? Array.from(selectedSpotsForReservation)
            : fallbackSingleSpot;
        const validUserStickers = getValidUserStickers();        // Validate spot selection
        if (normalizedSpots.length === 0) {
            showError('Please select at least one parking spot to reserve.');
            return;
        }

        // CRITICAL: User MUST have approved sticker to reserve - applies to BOTH single and multi-spot
        if (validUserStickers.length === 0) {
            showError("You can't reserve without any valid parking stickers. Please apply for a sticker first.");
            return;
        }

        // In single-select mode, use the currently selected spot as reservation target.
        setSelectedSpotsForReservation(new Set(normalizedSpots));
        setReservationSelectionOrder(normalizedSpots);

        // Reset form and open modal
        if (normalizedSpots.length === 1) {
            setReserveStickerInput(validUserStickers[0] || '');
            setReservePlateInput('');
        } else {
            setReserveStickerInput('');
            setReservePlateInput('');
        }
        setReserveDate('');
        setReserveTime('');
        setReservationReasonText('');
        setReservationReasonCategory('');
        setReservationOrgName('');
        setReservationEventName('');
        setReservationActivityForm('');
        setReservationRequesterName('');
        setReservationOrgPosition('');
        setReservationModalError('');
        setShowReservationModal(true);
    };

    // Validates reservation form data and submits it to backend.
    // Teaching note:
    // - We do strict validation first (fail fast), then network call.
    // - This keeps user feedback immediate and avoids unnecessary API traffic.
    // - Single-spot flow requires sticker ownership, while multi-spot can use N/A sticker.
    const handleSubmitReservation = () => {
        // Clear previous modal error before new validation pass.
        setReservationModalError('');

        if (!reserveDate || !reserveTime) {
            setReservationModalError('Please select reserve date and time.');
            return;
        }

        const selectedDate = new Date(`${reserveDate}T${reserveTime}`);
        if (Number.isNaN(selectedDate.getTime())) {
            setReservationModalError('Invalid reserve date and time.');
            return;
        }

        if (selectedDate <= new Date()) {
            setReservationModalError('Reserve date/time must be in the future.');
            return;
        }

        let sticker = 'N/A';
        const validUserStickers = getValidUserStickers();

        // Build reason text based on spot count.
        // single spot: short personal reason
        // multi-spot: structured payload-like sentence for admin review context
        let finalReason = '';
        let reservationCategoryPayload = 'single';
        if (selectedSpotsForReservation.size === 1) {
            // Single-spot reservations require a valid user sticker.
            if (validUserStickers.length === 0) {
                setReservationModalError("You can't reserve without any valid parking stickers.");
                return;
            }
            if (!reserveStickerInput.trim()) {
                setReservationModalError('Please select your UA sticker ID.');
                return;
            }
            sticker = reserveStickerInput.trim().toUpperCase();
            if (!validUserStickers.includes(sticker)) {
                setReservationModalError('Selected sticker ID is not valid for this account this semester.');
                return;
            }
            const plateNumber = getPlateFromSticker(sticker);
            if (!plateNumber) {
                setReservationModalError('Invalid sticker ID or not valid for the current semester.');
                return;
            }

            // Single spot: reason is just the text they entered
            if (!reservationReasonText.trim()) {
                setReservationModalError('Please provide a reason for the reservation.');
                return;
            }
            finalReason = reservationReasonText.trim();        } else {
            // Multi-spot reservations ALSO require a valid user sticker - cannot reserve without approved sticker
            if (validUserStickers.length === 0) {
                setReservationModalError("You can't reserve without any valid parking stickers. Please apply for a sticker first.");
                return;
            }

            // Multi-spot reservations are treated as organizational/guest-style requests.
            reservationCategoryPayload = reservationReasonCategory;
            const plateNumber = (reservePlateInput || '').trim().toUpperCase();

            if (!reservationReasonCategory) {
                setReservationModalError('Please choose a Reason Category first.');
                return;
            }

            if (!plateNumber) {
                setReservationModalError('Please enter Plate Number.');
                return;
            }

            if (!reservationReasonText.trim()) {
                setReservationModalError('Please provide a detailed reason for the reservation.');
                return;
            }

            if (reservationReasonCategory === 'School Related Event') {
                if (!reservationEventName.trim()) {
                    setReservationModalError('Please enter Event Name.');
                    return;
                }
                if (!reservationActivityForm.trim()) {
                    setReservationModalError('Please enter Activity Form No.');
                    return;
                }
                if (!reservationRequesterName.trim()) {
                    setReservationModalError('Please enter the name of person requesting the reservation.');
                    return;
                }
                finalReason = `Category: School Related Event | Plate Number: ${plateNumber} | Event: ${reservationEventName.trim()} | Activity Form No: ${reservationActivityForm.trim()} | Requester: ${reservationRequesterName.trim()} | Details: ${reservationReasonText.trim()}`;
            } else if (reservationReasonCategory === 'Org Related Event') {
                if (!reservationOrgName.trim()) {
                    setReservationModalError('Please enter Org Name.');
                    return;
                }
                if (!reservationEventName.trim()) {
                    setReservationModalError('Please enter Event Name.');
                    return;
                }
                if (!reservationActivityForm.trim()) {
                    setReservationModalError('Please enter Activity Form.');
                    return;
                }
                if (!reservationRequesterName.trim()) {
                    setReservationModalError('Please enter the name of person requesting the reservation.');
                    return;
                }
                if (!reservationOrgPosition.trim()) {
                    setReservationModalError('Please enter Org Position.');
                    return;
                }
                finalReason = `Category: Org Related Event | Plate Number: ${plateNumber} | Org: ${reservationOrgName.trim()} | Event: ${reservationEventName.trim()} | Activity Form: ${reservationActivityForm.trim()} | Requester: ${reservationRequesterName.trim()} | Position: ${reservationOrgPosition.trim()} | Details: ${reservationReasonText.trim()}`;
            } else {
                if (!reservationRequesterName.trim()) {
                    setReservationModalError('Please enter the name of person requesting the reservation.');
                    return;
                }
                finalReason = `Category: Others | Plate Number: ${plateNumber} | Requester: ${reservationRequesterName.trim()} | Details: ${reservationReasonText.trim()}`;
            }
        }

        // Submit reservation to backend API.
        // Async operation is nested so the outer function remains "validation-first".
        const submitReservation = async () => {
            try {
            // Close modal immediately after submit click for snappier UX.
                setShowReservationModal(false);

                const response = await axios.post(`${API_BASE_URL}/submit-reservation/`, {
                    username: user.username,
                    auth_token: user.authToken || JSON.parse(localStorage.getItem('currentUser') || 'null')?.authToken || '',
                    sticker_id: sticker,
                    reservation_category: reservationCategoryPayload,
                    reserved_spots: Array.from(selectedSpotsForReservation),
                    reservation_reason: finalReason,
                    reserved_for_datetime: selectedDate.toISOString()
                });

                if (response.data.status === 'success') {
                    showSuccess(`Reservation submitted for ${selectedSpotsForReservation.size} spot(s). Waiting for admin approval...`);
                    
                    // Clear form and reset state
                    setReserveStickerInput('');
                    setReservePlateInput('');
                    setReserveDate('');
                    setReserveTime('');
                    setReservationReasonText('');
                    setReservationReasonCategory('');
                    setReservationOrgName('');
                    setReservationEventName('');
                    setReservationActivityForm('');
                    setReservationRequesterName('');
                    setReservationOrgPosition('');
                    setSelectedSpotsForReservation(new Set());
                    setReservationSelectionOrder([]);
                    setIsMultiSelectMode(false);
                    
                    // Refresh reservations list so dashboard table reflects latest server state.
                    fetchUserReservations(user.username);
                } else {
                    showError(response.data.message || 'Failed to submit reservation');
                }
            } catch (error) {
                console.error('Reservation submission error:', error);
                showError(error.response?.data?.message || 'Error submitting reservation');
            }
        };

        submitReservation();
    };

    // Cancel modal and reset all reservation fields to a clean state.
    // This prevents stale values from a previous attempt leaking into next attempt.
    const handleCancelReservationModal = () => {
        setShowReservationModal(false);
        setReservationModalError('');
        setReserveStickerInput('');
        setReservePlateInput('');
        setReserveDate('');
        setReserveTime('');
        setReservationReasonText('');
        setReservationReasonCategory('');
        setReservationOrgName('');
        setReservationEventName('');
        setReservationActivityForm('');
        setReservationRequesterName('');
        setReservationOrgPosition('');
        setReservationSelectionOrder([]);
    };

    // Build a fully normalized slot array sized to TOTAL_PARKING_SLOTS.
    // If a slot is missing in source state, create an "available" placeholder.
    const displayParkingSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => {
        return parkingSlots.find(slot => slot.id === i + 1) || {
            id: i + 1,
            status: 'available',
            plateNumber: '',
            stickerId: '',
            entryTime: null,
            reservedFor: null,
            reservedStickerId: ''
        };
    });

    // Resolve the active parking area object from selected name.
    const selectedParkingArea = parkingAreas.find(area => area.name === selectedParkingAreaName) || parkingAreas[0];
    // Current design shows one area at a time, but array keeps render loop extensible.
    const visibleParkingAreas = [selectedParkingArea];
    // Memo-like helper call for selected slot details panel.
    const selectedParkingSlot = getSelectedParkingSlot();
    const selectedSlotReservation = getReservationForSlot(selectedParkingSlot);
    const selectedSlotReservationSpots = selectedSlotReservation
        ? formatReservationSpotList(selectedSlotReservation)
        : '';
    const selectedSpotStatusText = selectedSlotReservation
        ? 'Reserved'
        : getSlotStatusText(selectedParkingSlot || {});
    const selectedMainTab = parentActiveTab === 'stickers' ? 'stickers' : activeTab;

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '22px', flexWrap: 'nowrap' }}>
                <div style={{ flex: '0 0 260px', width: '260px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <aside className="user-nav-panel">
                        <div className="nav-section-title">Navigation</div>

                        <div className="nav-button-group">
                            {/* Tab buttons only affect UI layout; no data fetch happens here. */}
                            <button
                                type="button"
                                className={`tab-button ${selectedMainTab === 'dashboard' ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveTab('dashboard');
                                    setParentActiveTab && setParentActiveTab('dashboard');
                                }}
                            >
                                Dashboard
                            </button>
                            <button
                                type="button"
                                className={`tab-button ${selectedMainTab === 'parking-map' ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveTab('parking-map');
                                    setParentActiveTab && setParentActiveTab('parking-map');
                                }}
                            >
                                Parking Map
                            </button>
                            <button
                                type="button"
                                className={`tab-button ${selectedMainTab === 'stickers' ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveTab('stickers');
                                    setParentActiveTab && setParentActiveTab('stickers');
                                }}
                            >
                                Sticker
                            </button>
                        </div>
                    </aside>

                    {activeTab === 'parking-map' && (
                        <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', padding: '10px', background: '#f8fafc' }}>
                            <h4 style={{ margin: '0 0 10px', color: '#0f172a', fontSize: '0.9rem' }}>Parking Map</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {parkingAreas.map((area) => {
                                    // Visual highlight differs per area for quick orientation.
                                    const isActive = selectedParkingAreaName === area.name;
                                    const activeStyleByArea = area.name === 'Old Parking Space'
                                        ? { border: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8' }
                                        : area.name === 'Vertical Parking Space'
                                            ? { border: '1px solid #ccfbf1', background: '#ecfeff', color: '#0f766e' }
                                            : { border: '1px solid #fbcfe8', background: '#fdf2f8', color: '#be185d' };

                                    return (
                                        <button
                                            key={`sidebar-${area.name}`}
                                        type="button"
                                        onClick={() => {
                                            setSelectedParkingAreaName(area.name);
                                            setSelectedParkingSlotId(null);
                                        }}
                                        style={{
                                            padding: '8px 10px',
                                            borderRadius: '8px',
                                            fontSize: '0.85rem',
                                            fontWeight: 700,
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            ...(isActive
                                                ? activeStyleByArea
                                                : { border: '1px solid #e2e8f0', background: '#ffffff', color: '#475569' })
                                        }}
                                    >
                                        {area.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {selectedMainTab === 'parking-map' && (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', padding: '10px', background: '#f8fafc' }}>
                        <h4 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '0.9rem' }}>Spot Interaction</h4>
                        {selectedParkingSlot ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', lineHeight: 1.2 }}>
                                <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Spot ID:</span> <strong>{selectedParkingSlot.id}</strong></div>
                                <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Status:</span> <strong>{selectedSpotStatusText}</strong></div>
                                {selectedSlotReservation ? (
                                    <>
                                        <div style={{ width: '100%', textAlign: 'left', wordBreak: 'break-word' }}><span style={{ color: '#64748b' }}>User:</span> <strong>{getReservationUserDisplay(selectedSlotReservation.applicant_username)}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Sticker:</span> <strong>{selectedSlotReservation.sticker_id || selectedParkingSlot.reservedStickerId || '---'}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Slot/s:</span> <strong>{selectedSlotReservationSpots || getSpotLabel(selectedParkingSlot.id)}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Date:</span> <strong>{formatReservationDateOnly(selectedSlotReservation.reserved_for_datetime || selectedParkingSlot.reservedFor)}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Time:</span> <strong>{formatReservationTimeOnly(selectedSlotReservation.reserved_for_datetime || selectedParkingSlot.reservedFor)}</strong></div>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Assigned Sticker ID:</span> <strong>{selectedParkingSlot.stickerId || '---'}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Reserved For:</span> <strong>{formatDateTime(selectedSlotReservation?.reserved_for_datetime || selectedParkingSlot.reservedFor)}</strong></div>
                                        <div style={{ width: '100%', textAlign: 'left' }}><span style={{ color: '#64748b' }}>Reserved Sticker:</span> <strong>{selectedSlotReservation?.sticker_id || selectedParkingSlot.reservedStickerId || '---'}</strong></div>
                                    </>
                                )}

                                {(selectedParkingSlot.status === 'available' || isMultiSelectMode) && (
                                    // Action group for reserve/park workflows on available spots.
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                        <button
                                            type="button"
                                            onClick={handleToggleMultiSelectMode}
                                            style={{
                                                padding: '6px 10px',
                                                background: isMultiSelectMode ? '#8b5cf6' : '#e2e8f0',
                                                color: isMultiSelectMode ? 'white' : '#64748b',
                                                border: 'none',
                                                borderRadius: '6px',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            {isMultiSelectMode ? '☑' : '☐'} Select Multiple
                                        </button>

                                        {isMultiSelectMode && (
                                            // Undo/Clear controls are only meaningful in multi-select mode.
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    className="btn-gray"
                                                    onClick={handleUndoReservationSelection}
                                                    disabled={reservationSelectionOrder.length === 0}
                                                    style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', opacity: reservationSelectionOrder.length === 0 ? 0.5 : 1 }}
                                                >
                                                    Undo Last
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-gray"
                                                    onClick={handleClearReservationSelections}
                                                    disabled={selectedSpotsForReservation.size === 0}
                                                    style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', opacity: selectedSpotsForReservation.size === 0 ? 0.5 : 1 }}
                                                >
                                                    Clear All
                                                </button>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                            <button
                                                type="button"
                                                className="btn-blue"
                                                onClick={() => {
                                                    if (isGuestReservationWindow(selectedParkingSlot)) {
                                                        setParkPlateInput('');
                                                        setParkStickerInput('');
                                                    } else {
                                                        const validStickers = getValidUserStickers();
                                                        setParkStickerInput(validStickers[0] || '');
                                                    }
                                                    setShowParkForSelectedSpot(true);
                                                }}
                                                disabled={isMultiSelectMode}
                                                style={{
                                                    marginTop: 0,
                                                    padding: '9px 14px',
                                                    fontSize: '12px',
                                                    minWidth: '88px',
                                                    whiteSpace: 'nowrap',
                                                    width: 'auto',
                                                    opacity: isMultiSelectMode ? 0.5 : 1,
                                                    cursor: isMultiSelectMode ? 'not-allowed' : 'pointer'
                                                }}
                                            >
                                                Park
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-purple"
                                                onClick={handleOpenReservationModal}
                                                style={{ marginTop: 0, padding: '9px 14px', fontSize: '12px', minWidth: '132px', whiteSpace: 'nowrap', width: 'auto' }}
                                            >
                                                {isMultiSelectMode
                                                    ? `Reserve Spot(s) (${selectedSpotsForReservation.size})`
                                                    : 'Reserve Spot(s)'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {selectedParkingSlot.status === 'occupied' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                        <button
                                            type="button"
                                            className="btn-gray"
                                            onClick={handleLeaveSelectedSpot}
                                            disabled={!isCurrentUserSpot(selectedParkingSlot)}
                                            style={{
                                                marginTop: 0,
                                                padding: '8px 10px',
                                                fontSize: '12px',
                                                opacity: isCurrentUserSpot(selectedParkingSlot) ? 1 : 0.55,
                                                cursor: isCurrentUserSpot(selectedParkingSlot) ? 'pointer' : 'not-allowed'
                                            }}
                                        >
                                            Leave / Check Out
                                        </button>
                                        {!isCurrentUserSpot(selectedParkingSlot) && (
                                            <div style={{ fontSize: '11px', color: '#92400e' }}>
                                                You can only check out spots parked using your own sticker.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {isMultiSelectMode && (
                                    <div style={{
                                        padding: '8px 10px',
                                        borderRadius: '8px',
                                        background: '#ede9fe',
                                        border: '1px solid #c4b5fd',
                                        color: '#5b21b6',
                                        fontSize: '12px'
                                    }}>
                                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Multi-select ON</div>
                                        <div>
                                            Selected spots: {selectedSpotsForReservation.size > 0
                                                ? Array.from(selectedSpotsForReservation).sort((a, b) => a - b).join(', ')
                                                : 'None yet'}
                                        </div>
                                    </div>
                                )}

                                {selectedParkingSlot.status === 'available' && showParkForSelectedSpot && (
                                    // Inline mini-form to complete parking action for selected spot.
                                    <div style={{ border: '1px solid #bfdbfe', borderRadius: '8px', background: '#eff6ff', padding: '8px', marginTop: '8px' }}>
                                        <div style={{ fontSize: '11px', color: '#1e40af', marginBottom: '6px', fontWeight: 600 }}>
                                            Parking Spot #{selectedParkingSlot.id}
                                        </div>
                                        {isGuestReservationWindow(selectedParkingSlot) ? (
                                            // Guest reservation path: plate number only, no sticker required.
                                            <input
                                                type="text"
                                                placeholder="Enter Plate Number"
                                                value={parkPlateInput}
                                                onChange={(e) => setParkPlateInput(e.target.value)}
                                                style={{ margin: 0 }}
                                            />
                                        ) : (() => {
                                            // Sticker path: choose from current user's valid stickers this semester.
                                            const parkStickerOptions = getValidUserStickers();

                                            if (parkStickerOptions.length === 0) {
                                                return (
                                                    <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 700 }}>
                                                        No valid parking sticker found for this account this semester.
                                                    </div>
                                                );
                                            }

                                            if (parkStickerOptions.length === 1) {
                                                return (
                                                    <input
                                                        type="text"
                                                        value={parkStickerOptions[0]}
                                                        disabled
                                                        style={{ margin: 0, background: '#f8fafc', color: '#334155' }}
                                                    />
                                                );
                                            }

                                            return (
                                                <select
                                                    value={parkStickerInput}
                                                    onChange={(e) => setParkStickerInput(e.target.value)}
                                                    style={{ margin: 0 }}
                                                >
                                                    {parkStickerOptions.map((stickerOption) => (
                                                        <option key={stickerOption} value={stickerOption}>{stickerOption}</option>
                                                    ))}
                                                </select>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                            {(() => {
                                                const parkStickerOptions = getValidUserStickers();
                                                const noValidSticker = !isGuestReservationWindow(selectedParkingSlot) && parkStickerOptions.length === 0;

                                                return (
                                                <button
                                                    type="button"
                                                    className="btn-green"
                                                    onClick={handleParkSelectedSpot}
                                                    disabled={noValidSticker}
                                                    style={{
                                                        marginTop: 0,
                                                        padding: '8px 10px',
                                                        fontSize: '12px',
                                                        opacity: noValidSticker ? 0.5 : 1,
                                                        cursor: noValidSticker ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    Confirm Park
                                                </button>
                                                    );
                                            })()}
                                            <button
                                                type="button"
                                                className="btn-gray"
                                                onClick={() => setShowParkForSelectedSpot(false)}
                                                style={{ marginTop: 0, padding: '8px 10px', fontSize: '12px' }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                            </div>
                        ) : (
                            <div style={{ color: '#64748b', fontSize: '12px' }}>
                                Click a spot to see Spot ID, Status, and Assigned Sticker ID.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* MAIN CONTENT AREA */}
            {/* Right column: either reservation dashboard cards/table or full parking map grid */}
            <div style={{ flex: '1 1 680px', minWidth: 0 }}>
                {selectedMainTab === 'stickers' && (
                    <StickerManagement
                        user={user}
                        records={records}
                        paymentMethods={paymentMethods}
                        displayFullName={displayFullName}
                        decryptData={decryptData}
                        fetchUserRecords={fetchUserRecords}
                    />
                )}

                {selectedMainTab === 'dashboard' && (
                    // Dedicated component keeps reservation dashboard concerns isolated.
                    <ParkingReservationPanel
                        userReservations={userReservations}
                        parkingSlots={parkingSlots}
                        totalParkingSlots={TOTAL_PARKING_SLOTS}
                    />
                )}

                {selectedMainTab === 'parking-map' && (
                <div className="panel">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '15px' }}>
                        <h3 className="panel-title" style={{ margin: 0 }}>Parking Layout Grid</h3>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '12px', color: '#64748b', flexWrap: 'wrap' }}>
                            <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#9ca3af', borderRadius: '50%', marginRight: '6px' }}></span>Available</span>
                            <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#ef4444', borderRadius: '50%', marginRight: '6px' }}></span>Occupied</span>
                            <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#ca8a04', borderRadius: '50%', marginRight: '6px' }}></span>Reserved</span>
                            <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#14b8a6', borderRadius: '50%', marginRight: '6px' }}></span>Selected</span>
                        </div>
                    </div>

                    {displayParkingSlots.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
                            <p style={{ fontSize: '14px' }}>No parking slots available</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ width: '100%', overflowX: 'auto' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: '980px' }}>
                                {visibleParkingAreas.map((area) => {
                                    // For active area, render rows/columns and slot buttons.
                                    const areaSlots = displayParkingSlots.slice(area.startId - 1, area.startId - 1 + area.slotCount);

                                    return (
                                        <div key={area.name} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
                                            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#334155' }}>{area.name}</h4>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                                                {area.name === 'Vertical Parking Space' ? (
                                                    // Vertical area uses column-first layout with lane/gutter strips between groups.
                                                    <>
                                                        <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'flex-start', gap: '16px', overflowX: 'auto', paddingBottom: '6px' }}>
                                                            {Array.from({ length: 5 }, (_, columnIndex) => {
                                                                const columnSlots = areaSlots.slice(columnIndex * 10, (columnIndex + 1) * 10);

                                                                return (
                                                                    <div key={`${area.name}-col-${columnIndex}`} style={{ display: 'flex', alignItems: 'stretch', gap: '16px', flex: '0 0 auto' }}>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '170px' }}>
                                                                            {columnSlots.map(slot => {
                                                                                const slotStyle = getParkingSlotFill(slot);
                                                                                const isSelected = selectedParkingSlotId === slot.id;

                                                                                return (
                                                                                    <button
                                                                                        key={slot.id}
                                                                                        type="button"
                                                                                        onDoubleClick={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            handleToggleMultiSelectMode();
                                                                                        }}
                                                                                        onClick={() => {
                                                                                            if (isMultiSelectMode) {
                                                                                                setSelectedParkingSlotId(slot.id);
                                                                                                setSelectedSpotsForReservation((prevSelected) => {
                                                                                                    const nextSelected = new Set(prevSelected);
                                                                                                    if (nextSelected.has(slot.id)) {
                                                                                                        nextSelected.delete(slot.id);
                                                                                                        setReservationSelectionOrder((prevOrder) => prevOrder.filter((id) => id !== slot.id));
                                                                                                    } else {
                                                                                                        nextSelected.add(slot.id);
                                                                                                        setReservationSelectionOrder((prevOrder) => [...prevOrder.filter((id) => id !== slot.id), slot.id]);
                                                                                                    }
                                                                                                    return nextSelected;
                                                                                                });
                                                                                            } else {
                                                                                                setSelectedParkingSlotId(isSelected ? null : slot.id);
                                                                                            }
                                                                                        }}
                                                                                        aria-pressed={isMultiSelectMode ? selectedSpotsForReservation.has(slot.id) : isSelected}
                                                                                        title={getSlotTooltipText(slot)}
                                                                                        style={{
                                                                                            border: `2px solid ${slotStyle.borderColor}`,
                                                                                            borderRadius: '14px',
                                                                                            padding: '14px 10px',
                                                                                            textAlign: 'center',
                                                                                            background: isMultiSelectMode && selectedSpotsForReservation.has(slot.id) 
                                                                                                ? '#bbf7d0'
                                                                                                : slotStyle.background,
                                                                                            color: isMultiSelectMode && selectedSpotsForReservation.has(slot.id)
                                                                                                ? '#14532d'
                                                                                                : slotStyle.color,
                                                                                            boxShadow: isMultiSelectMode && selectedSpotsForReservation.has(slot.id) 
                                                                                                ? '0 0 0 3px #22c55e'
                                                                                                : slotStyle.shadow,
                                                                                            borderColor: isMultiSelectMode && selectedSpotsForReservation.has(slot.id)
                                                                                                ? '#22c55e'
                                                                                                : slotStyle.borderColor,
                                                                                            cursor: 'pointer',
                                                                                            minHeight: '90px',
                                                                                            display: 'flex',
                                                                                            flexDirection: 'column',
                                                                                            justifyContent: 'center',
                                                                                            alignItems: 'center',
                                                                                            gap: '4px',
                                                                                            transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
                                                                                        }}
                                                                                    >
                                                                                        <div style={{ fontSize: '1.45rem', fontWeight: 800, lineHeight: 1 }}>P</div>
                                                                                        <div style={{ fontSize: '0.9rem', fontWeight: 800 }}>#{slot.id}</div>
                                                                                        <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.9 }}>
                                                                                            {getSlotStatusText(slot)}
                                                                                        </div>
                                                                                        {isMultiSelectMode && selectedSpotsForReservation.has(slot.id) && (
                                                                                            <div style={{
                                                                                                fontSize: '0.66rem',
                                                                                                fontWeight: 800,
                                                                                                color: '#14532d',
                                                                                                background: '#dcfce7',
                                                                                                border: '1px solid #86efac',
                                                                                                borderRadius: '999px',
                                                                                                padding: '2px 6px',
                                                                                                lineHeight: 1
                                                                                            }}>
                                                                                                Selected
                                                                                            </div>
                                                                                        )}
                                                                                        {slot.stickerId && (
                                                                                            <div style={{ fontSize: '0.66rem', opacity: 0.95, wordBreak: 'break-word' }}>
                                                                                                {slot.stickerId}
                                                                                            </div>
                                                                                        )}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>

                                                                        {columnIndex < 4 && (
                                                                            <div style={{ width: '36px', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'stretch' }}>
                                                                                <div
                                                                                    style={{
                                                                                        width: (columnIndex === 1 || columnIndex === 3) ? '24px' : '18px',
                                                                                        borderRadius: '12px',
                                                                                        background: (columnIndex === 1 || columnIndex === 3)
                                                                                            ? 'linear-gradient(180deg, #4b5563 0%, #374151 100%)'
                                                                                            : '#94a3b8',
                                                                                        border: (columnIndex === 1 || columnIndex === 3) ? '1px solid #334155' : '1px solid #94a3b8',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        justifyContent: 'center',
                                                                                        overflow: 'hidden'
                                                                                    }}
                                                                                >
                                                                                    <span
                                                                                        style={{
                                                                                            writingMode: 'vertical-rl',
                                                                                            textOrientation: 'mixed',
                                                                                            fontSize: '9px',
                                                                                            letterSpacing: '0.8px',
                                                                                            textTransform: 'uppercase',
                                                                                            fontWeight: 800,
                                                                                            color: (columnIndex === 1 || columnIndex === 3) ? '#ffffff' : '#1e293b',
                                                                                            opacity: 0.95
                                                                                        }}
                                                                                    >
                                                                                        {(columnIndex === 1 || columnIndex === 3) ? 'Road / Lane' : 'Gutter / Island'}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </>
                                                ) : (
                                                    // Old/New areas use row-based parking layout.
                                                    <>
                                                        {Array.from({ length: area.totalRows }, (_, rowIndex) => {
                                                            const startIndex = rowIndex * area.slotsPerRow;
                                                            const rowSlots = areaSlots.slice(startIndex, startIndex + area.slotsPerRow);

                                                            return (
                                                                <div key={`${area.name}-${rowIndex}`}>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${area.slotsPerRow}, minmax(0, 1fr))`, gap: '12px' }}>
                                                                        {rowSlots.map(slot => {
                                                                            const slotStyle = getParkingSlotFill(slot);
                                                                            const isSelected = selectedParkingSlotId === slot.id;

                                                                                return (
                                                                                    <button
                                                                                        key={slot.id}
                                                                                        type="button"
                                                                                        onDoubleClick={(e) => {
                                                                                            e.preventDefault();
                                                                                            e.stopPropagation();
                                                                                            handleToggleMultiSelectMode();
                                                                                        }}
                                                                                        onClick={() => {
                                                                                            if (isMultiSelectMode) {
                                                                                                setSelectedParkingSlotId(slot.id);
                                                                                                setSelectedSpotsForReservation((prevSelected) => {
                                                                                                    const nextSelected = new Set(prevSelected);
                                                                                                    if (nextSelected.has(slot.id)) {
                                                                                                        nextSelected.delete(slot.id);
                                                                                                        setReservationSelectionOrder((prevOrder) => prevOrder.filter((id) => id !== slot.id));
                                                                                                    } else {
                                                                                                        nextSelected.add(slot.id);
                                                                                                        setReservationSelectionOrder((prevOrder) => [...prevOrder.filter((id) => id !== slot.id), slot.id]);
                                                                                                    }
                                                                                                    return nextSelected;
                                                                                                });
                                                                                            } else {
                                                                                                setSelectedParkingSlotId(isSelected ? null : slot.id);
                                                                                            }
                                                                                        }}
                                                                                        aria-pressed={isMultiSelectMode ? selectedSpotsForReservation.has(slot.id) : isSelected}
                                                                                        title={getSlotTooltipText(slot)}
                                                                                        style={{
                                                                                            border: `2px solid ${isMultiSelectMode && selectedSpotsForReservation.has(slot.id) ? '#22c55e' : slotStyle.borderColor}`,
                                                                                            borderRadius: '14px',
                                                                                            padding: '14px 10px',
                                                                                            textAlign: 'center',
                                                                                            background: isMultiSelectMode && selectedSpotsForReservation.has(slot.id) ? '#bbf7d0' : slotStyle.background,
                                                                                            color: isMultiSelectMode && selectedSpotsForReservation.has(slot.id) ? '#14532d' : slotStyle.color,
                                                                                            boxShadow: isMultiSelectMode && selectedSpotsForReservation.has(slot.id) ? '0 0 0 3px #22c55e' : slotStyle.shadow,
                                                                                            cursor: 'pointer',
                                                                                            minHeight: '120px',
                                                                                            display: 'flex',
                                                                                            flexDirection: 'column',
                                                                                            justifyContent: 'center',
                                                                                            alignItems: 'center',
                                                                                            gap: '6px',
                                                                                            transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
                                                                                        }}
                                                                                    >
                                                                                    <div style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1 }}>P</div>
                                                                                    <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>#{slot.id}</div>
                                                                                    <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.9 }}>
                                                                                        {getSlotStatusText(slot)}
                                                                                    </div>
                                                                                    {isMultiSelectMode && selectedSpotsForReservation.has(slot.id) && (
                                                                                        <div style={{
                                                                                            fontSize: '0.66rem',
                                                                                            fontWeight: 800,
                                                                                            color: '#14532d',
                                                                                            background: '#dcfce7',
                                                                                            border: '1px solid #86efac',
                                                                                            borderRadius: '999px',
                                                                                            padding: '2px 6px',
                                                                                            lineHeight: 1
                                                                                        }}>
                                                                                            Selected
                                                                                        </div>
                                                                                    )}
                                                                                    {slot.stickerId && (
                                                                                        <div style={{ fontSize: '0.68rem', opacity: 0.95, wordBreak: 'break-word' }}>
                                                                                            {slot.stickerId}
                                                                                        </div>
                                                                                    )}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>

                                                                    {(area.name === 'Old Parking Space' && (rowIndex === 0 || rowIndex === 2)) && (
                                                                        <div style={{ margin: '18px 0 2px', position: 'relative', height: '54px', borderRadius: '10px', overflow: 'hidden', background: 'linear-gradient(180deg, #4b5563 0%, #374151 100%)', border: '1px solid #1f2937' }}>
                                                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '12px', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' }}>
                                                                                Road / Lane
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {(area.name === 'Old Parking Space' && rowIndex === 1) && (
                                                                        <div style={{ margin: '10px 0 4px', position: 'relative', height: '20px', borderRadius: '8px', overflow: 'hidden', background: '#9ca3af', border: '1px solid #94a3b8' }}>
                                                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                                                                                Gutter / Island
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {(area.name === 'New Parking Space' && (rowIndex === 0 || rowIndex === 2 || rowIndex === 4)) && (
                                                                        <div style={{ margin: '18px 0 2px', position: 'relative', height: '54px', borderRadius: '10px', overflow: 'hidden', background: 'linear-gradient(180deg, #4b5563 0%, #374151 100%)', border: '1px solid #1f2937' }}>
                                                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '12px', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' }}>
                                                                                Road / Lane
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {(area.name === 'New Parking Space' && (rowIndex === 1 || rowIndex === 3)) && (
                                                                        <div style={{ margin: '10px 0 4px', position: 'relative', height: '20px', borderRadius: '8px', overflow: 'hidden', background: '#9ca3af', border: '1px solid #94a3b8' }}>
                                                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                                                                                Gutter / Island
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            </div>
                        </div>
                    )}
                </div>
                )}
            </div>
        </div>

            {/* Reservation modal is controlled entirely by state in this component. */}
            <ReservationModal
                isOpen={showReservationModal}
                selectedSpotsForReservation={selectedSpotsForReservation}
                isMultiSelectMode={isMultiSelectMode}
                reservationModalError={reservationModalError}
                reserveStickerInput={reserveStickerInput}
                setReserveStickerInput={setReserveStickerInput}
                reservePlateInput={reservePlateInput}
                setReservePlateInput={setReservePlateInput}
                reservationReasonText={reservationReasonText}
                setReservationReasonText={setReservationReasonText}
                reservationReasonCategory={reservationReasonCategory}
                setReservationReasonCategory={setReservationReasonCategory}
                reservationOrgName={reservationOrgName}
                setReservationOrgName={setReservationOrgName}
                reservationEventName={reservationEventName}
                setReservationEventName={setReservationEventName}
                reservationActivityForm={reservationActivityForm}
                setReservationActivityForm={setReservationActivityForm}
                reservationRequesterName={reservationRequesterName}
                setReservationRequesterName={setReservationRequesterName}
                reservationOrgPosition={reservationOrgPosition}
                setReservationOrgPosition={setReservationOrgPosition}
                reserveDate={reserveDate}
                setReserveDate={setReserveDate}
                reserveTime={reserveTime}
                setReserveTime={setReserveTime}
                getValidUserStickers={getValidUserStickers}
                onSubmit={handleSubmitReservation}
                onCancel={handleCancelReservationModal}
            />

            {/* LEAVE CONFIRM MODAL */}
            {showLeaveConfirmModal && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.55)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    padding: '16px'
                }}>
                    <div style={{
                        width: '100%',
                        maxWidth: '420px',
                        background: '#ffffff',
                        borderRadius: '14px',
                        boxShadow: '0 18px 42px rgba(15, 23, 42, 0.22)',
                        border: '1px solid #e2e8f0',
                        padding: '18px'
                    }}>
                        <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '1rem' }}>Confirm Check Out</h3>
                        <p style={{ margin: '0 0 14px', color: '#475569', fontSize: '13px' }}>
                            Leave/check out spot #{leaveConfirmSlotId} now?
                        </p>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                type="button"
                                className="btn-green"
                                onClick={handleConfirmLeaveSelectedSpot}
                                style={{ flex: 1, marginTop: 0 }}
                            >
                                Yes, Check Out
                            </button>
                            <button
                                type="button"
                                className="btn-gray"
                                onClick={() => {
                                    setShowLeaveConfirmModal(false);
                                    setLeaveConfirmSlotId(null);
                                }}
                                style={{ flex: 1, marginTop: 0 }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
