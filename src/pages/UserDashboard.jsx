import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PasswordField from '../components/PasswordField';
import { usePopup } from '../components/PopupContext';
import ParkingManagement from '../components/ParkingManagement';
import { encryptDES, decryptDES } from '../utils/desCrypto';
import API_BASE_URL from '../config/api';
import ualogo from '../assets/ualogo.png';

/**
 * ============================================================
 * UserDashboard Component
 * ============================================================
 * 
 * Main orchestrator page for logged-in users.
 * Combines sticker management and parking management into one interface.
 * 
 * ARCHITECTURE:
 * UserDashboard (this file) = State & API calls owner
 *     ├── StickerManagement = Sticker applications + payment + records table
 *     └── ParkingManagement = Parking slots visualization + reservations
 * 
 * Data Flow:
 * 1. On mount: fetch user profile, parking stickers (records), parking slots, user reservations
 * 2. Pass all data DOWN to child components as props (unidirectional data flow)
 * 3. Child components call parent's callback functions (e.g., fetchUserRecords) to trigger refreshes
 * 4. Example: User submits sticker app → StickerManagement calls fetchUserRecords → parent fetches updated list
 * 
 * State Organization:
 * - User profile data: user, oldPassword, newPassword, etc. (account settings)
 * - Sticker records: records (array of applications), plate, type (form inputs)
 * - Parking data: parkingSlots, userReservations (shared with ParkingManagement)
 * - UI state: showNotif, showSettings, activeTab, timeTick (visibility toggles and timing)
 * 
 * Key Functions:
 * - fetchUserInfo(): GET user profile from /api/user/<username>
 * - fetchUserRecords(): GET user's sticker applications from /api/sticker-records/
 * - fetchUserReservations(): GET user's parking reservations
 * - updatePassword(): PUT new password to backend
 * - decryptData(): Decrypt plate numbers from encrypted storage
 */
export default function UserDashboard() {
    const navigate = useNavigate();
    const { showError, showSuccess, showInfo } = usePopup();
    const passwordRule = /^(?=.*[A-Z])(?=.*\d).{8,}$/; // Regex: at least 1 uppercase, 1 digit, 8+ chars
    const TOTAL_PARKING_SLOTS = 180; // Total across all three parking areas (40 + 50 + 90)

    // ============ USER PROFILE STATE ============
    // Data fetched from /api/user/<username> on component mount
    const [user, setUser] = useState(null); // Current logged-in user (null until fetched)
    const [records, setRecords] = useState([]); // Array of user's sticker applications (decrypted for display)

    // ============ STICKER APPLICATION FORM STATE ============
    // Used by StickerManagement component
    const [plate, setPlate] = useState(''); // Plate input (managed here but mainly used in child)
    const [type] = useState('4-Wheels'); // Vehicle type defaults to 4-Wheels in current flow
    const [showNotif, setShowNotif] = useState(false); // Toggle notification panel visibility
    const [showSettings, setShowSettings] = useState(false); // Toggle settings/profile panel visibility
    const [showPaymentModal, setShowPaymentModal] = useState(false); // Toggle payment modal visibility
    const [timeTick, setTimeTick] = useState(Date.now()); // Current time (updated every 1 sec) - used for reservation expiration checks
    const [paymentMethod, setPaymentMethod] = useState('GCash'); // Selected payment method
    const [paymentReference, setPaymentReference] = useState(''); // Proof of payment reference

    // ============ PROFILE UPDATE STATE ============
    // Fields for password and identifier changes in settings panel
    const [oldPassword, setOldPassword] = useState(''); // User's current password (for verification)
    const [newPassword, setNewPassword] = useState(''); // New password (must match passwordRule)
    const [confirmNewPassword, setConfirmNewPassword] = useState(''); // Confirmation field (must match newPassword)
    const [newIdentifier, setNewIdentifier] = useState(''); // New student ID or identifier

    // ============ PARKING FUNCTIONALITY STATE ============
    // Shared with ParkingManagement component
    const [activeTab, setActiveTab] = useState('dashboard'); // Which tab is visible
    const [parkingSlots, setParkingSlots] = useState([]); // Array of all parking slots (180 total) with their status/occupant info
    
    const [userReservations, setUserReservations] = useState([]);
    const [reservationStatusNotifs, setReservationStatusNotifs] = useState([]);
    const [readReservationNotifKeys, setReadReservationNotifKeys] = useState([]);

    const paymentMethods = ['Pay On-Site', 'GCash', 'BPI', 'BDO', 'PNB', 'USSC', 'Palawan Express', 'RCBC', 'Cebuana Lhuillier'];

    // Dropdown data
    const strands = ["STEM", "ABM", "HUMSS", "GAS", "TVL"];
    const courses = ["BSIT", "BSCS", "BSBA", "BSCrim", "BSHM", "BSA", "BSED"];
    const nonStudentReasons = [
        'Parent/Guardian',
        'Service Personnel',
        'Visitor',
        'Delivery Rider',
        'Vendor/Supplier',
        'Alumni',
        'Event Participant',
        'Other'
    ];

    // Local alias used by existing UI code and child component props.
    const decryptData = (ciphertext) => decryptDES(ciphertext);

    const getCurrentSemesterRange = (baseDate = new Date()) => {
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth() + 1;

        if (month >= 8 && month <= 12) {
            return {
                start: new Date(year, 7, 1),
                end: new Date(year, 11, 31)
            };
        }

        if (month >= 1 && month <= 5) {
            return {
                start: new Date(year, 0, 1),
                end: new Date(year, 4, 31)
            };
        }

        return {
            start: new Date(year, 5, 1),
            end: new Date(year, 6, 31)
        };
    };

    const isStickerValidForCurrentSemester = (record) => {
        if (!record || record.status !== 'Approved' || !record.expiration_date) {
            return false;
        }

        const expiration = new Date(`${record.expiration_date}T00:00:00`);
        if (Number.isNaN(expiration.getTime())) {
            return false;
        }

        const { start, end } = getCurrentSemesterRange(new Date());
        return expiration >= start && expiration <= end;
    };

    /**
     * Get plate number from sticker ID by looking up user applications.
     */
    const getPlateFromSticker = (stickerId) => {
        if (!records || records.length === 0) return null;
        const normalizedStickerId = (stickerId || '').trim().toUpperCase();
        const application = records.find(r =>
            isStickerValidForCurrentSemester(r) &&
            (r.sticker_id || '').trim().toUpperCase() === normalizedStickerId
        );
        return application ? decryptData(application.plate_number) : null;
    };

    /**
     * Get valid sticker IDs for the current semester.
     */
    const getValidUserStickers = () => {
        if (!records || records.length === 0) return [];
        return [...new Set(records
            .filter(r => isStickerValidForCurrentSemester(r))
            .map(r => (r.sticker_id || '').trim().toUpperCase())
            .filter(id => id))];
    };

    /**
     * Initialize user session and fetch application records.
     * Redirects to login if no valid session exists.
     */
    useEffect(() => {
        const savedUser = JSON.parse(localStorage.getItem('currentUser'));
        if (!savedUser) {
            navigate('/');
        } else {
            setUser(savedUser);
            setNewIdentifier(savedUser.identifier || '');
            fetchUserRecords(savedUser.username);
            fetchUserReservations(savedUser.username);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeTick(Date.now());
        }, 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!user?.username) return;
        fetchUserReservations(user.username);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeTick, user?.username]);

    useEffect(() => {
        if (!user?.username) {
            setReservationStatusNotifs([]);
            setReadReservationNotifKeys([]);
            return;
        }

        const notifStorageKey = `reservationStatusNotifs_${user.username}`;
        const readStorageKey = `reservationStatusNotifRead_${user.username}`;

        const savedNotifs = JSON.parse(localStorage.getItem(notifStorageKey) || '[]');
        const savedReadKeys = JSON.parse(localStorage.getItem(readStorageKey) || '[]');

        setReservationStatusNotifs(Array.isArray(savedNotifs) ? savedNotifs : []);
        setReadReservationNotifKeys(Array.isArray(savedReadKeys) ? savedReadKeys : []);
    }, [user?.username]);

    useEffect(() => {
        if (!user?.username || !Array.isArray(userReservations)) return;

        const snapshotKey = `reservationStatusSnapshot_${user.username}`;
        const notifStorageKey = `reservationStatusNotifs_${user.username}`;

        const previousSnapshotRaw = JSON.parse(localStorage.getItem(snapshotKey) || '{}');
        const previousSnapshot = previousSnapshotRaw && typeof previousSnapshotRaw === 'object' ? previousSnapshotRaw : {};

        const storedNotifsRaw = JSON.parse(localStorage.getItem(notifStorageKey) || '[]');
        const storedNotifs = Array.isArray(storedNotifsRaw) ? storedNotifsRaw : [];
        const existingKeys = new Set(storedNotifs.map((item) => item.key));

        const nextSnapshot = {};
        const newNotifs = [];

        userReservations.forEach((reservation) => {
            const reservationId = String(reservation.id);
            const nextStatus = (reservation.status || '').toLowerCase();
            const previousStatus = (previousSnapshot[reservationId] || '').toLowerCase();
            nextSnapshot[reservationId] = nextStatus;

            if (!previousStatus || previousStatus === nextStatus) return;

            const notifKey = `${reservationId}-${nextStatus}`;
            if (existingKeys.has(notifKey)) return;

            newNotifs.push({
                key: notifKey,
                reservationId: reservation.id,
                previousStatus,
                nextStatus,
                reservedFor: reservation.reserved_for_datetime,
                adminNotes: (reservation.admin_notes || '').trim(),
                createdAt: new Date().toISOString()
            });
        });

        localStorage.setItem(snapshotKey, JSON.stringify(nextSnapshot));

        if (newNotifs.length > 0) {
            const mergedNotifs = [...newNotifs, ...storedNotifs].slice(0, 120);
            localStorage.setItem(notifStorageKey, JSON.stringify(mergedNotifs));
            setReservationStatusNotifs(mergedNotifs);

            const latest = newNotifs[0];
            showInfo(`Reservation #${latest.reservationId} changed to ${latest.nextStatus}.`, 2500);
            return;
        }

        setReservationStatusNotifs(storedNotifs);
    }, [user?.username, userReservations, showInfo]);

    /**
     * Load parking slots from localStorage.
     */
    useEffect(() => {
        const savedSlots = localStorage.getItem('parkingSlots');
        if (savedSlots) {
            const parsedSlots = JSON.parse(savedSlots);
            const normalizedSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => {
                const existingSlot = parsedSlots.find(slot => slot.id === i + 1);
                if (existingSlot) {
                    return {
                        ...existingSlot,
                        reservedFor: existingSlot.reservedFor || null,
                        reservedStickerId: existingSlot.reservedStickerId || ''
                    };
                }
                return {
                    id: i + 1,
                    status: 'available',
                    plateNumber: '',
                    stickerId: '',
                    entryTime: null,
                    reservedFor: null,
                    reservedStickerId: ''
                };
            });
            setParkingSlots(normalizedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(normalizedSlots));
        } else {
            const initialSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => ({
                id: i + 1,
                status: 'available',
                plateNumber: '',
                stickerId: '',
                entryTime: null,
                reservedFor: null,
                reservedStickerId: ''
            }));
            setParkingSlots(initialSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(initialSlots));
        }
    }, [TOTAL_PARKING_SLOTS]);

    /**
     * Fetch user's vehicle application records from backend.
     */
    const fetchUserRecords = async (username) => {
        try {
            const authToken = user?.authToken || JSON.parse(localStorage.getItem('currentUser') || 'null')?.authToken || '';
            const res = await axios.get(`${API_BASE_URL}/user-records/`, {
                params: {
                    username,
                    auth_token: authToken
                }
            });
            setRecords(res.data);
        } catch (err) {
            console.error("User fetch error:", err);
        }
    };

    /**
     * Fetch user's parking reservations (pending, approved, denied).
     */
    const fetchUserReservations = async (username) => {
        try {
            const authToken = user?.authToken || JSON.parse(localStorage.getItem('currentUser') || 'null')?.authToken || '';
            const res = await axios.get(`${API_BASE_URL}/user-reservations/`, {
                params: {
                    username,
                    auth_token: authToken
                }
            });
            setUserReservations(res.data);
        } catch (err) {
            console.error("Reservations fetch error:", err);
        }
    };

    const getReservationInfo = (slot) => {
        if (!slot?.reservedFor || !slot?.reservedStickerId) return null;
        const reservedAt = new Date(slot.reservedFor);
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

    const formatDateTime = (value) => {
        if (!value) return '---';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '---';
        return d.toLocaleString();
    };

    const getSlotStatusText = (slot) => {
        if (slot.status === 'occupied') return 'Occupied';
        const reservationInfo = getReservationInfo(slot);
        if (!reservationInfo) return 'Available';
        if (reservationInfo.isUpcoming) return 'Available';
        if (reservationInfo.isOverdue) return 'Reserved (Overdue)';
        if (reservationInfo.isActive) return 'Reserved (Now)';
        return 'Reserved';
    };

    const getSlotTooltipText = (slot) => {
        const lines = [
            `Spot ID: ${slot.id}`,
            `Status: ${getSlotStatusText(slot)}`,
            `Assigned Sticker ID: ${slot.stickerId || '---'}`
        ];

        if (slot.reservedStickerId || slot.reservedFor) {
            lines.push(`Reserved Sticker ID: ${slot.reservedStickerId || '---'}`);
            lines.push(`Reserved For: ${formatDateTime(slot.reservedFor)}`);
        }

        return lines.join('\n');
    };

    // Get notifications (application updates + reservation status updates)
    const applicationNotifications = records.slice();
    const unreadApplicationNotifications = records.filter(r => r.is_seen === false);
    const unreadReservationStatusNotifs = reservationStatusNotifs.filter(
        (notif) => !readReservationNotifKeys.includes(notif.key)
    );
    const unreadNotificationCount = unreadApplicationNotifications.length + unreadReservationStatusNotifs.length;

    useEffect(() => {
        if (!user?.username || parkingSlots.length === 0) return;

        const now = Date.now();
        const escalationDelayMs = 5 * 60 * 1000;
        const userNotifKey = `userReservationReminderNotifs_${user.username}`;
        const userNotifRaw = JSON.parse(localStorage.getItem(userNotifKey) || '[]');
        const userNotif = Array.isArray(userNotifRaw) ? userNotifRaw : [];

        const escalationNotifRaw = JSON.parse(localStorage.getItem('personnelEscalationNotifs') || '[]');
        const escalationNotif = Array.isArray(escalationNotifRaw) ? escalationNotifRaw : [];

        const approvedReservations = userReservations.filter(
            (reservation) => (reservation.status || '').toLowerCase() === 'approved'
        );

        let userChanged = false;
        let escalationChanged = false;

        approvedReservations.forEach((reservation) => {
            const reservedAt = new Date(reservation.reserved_for_datetime || '');
            if (Number.isNaN(reservedAt.getTime())) return;

            const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
            const overdueMs = now - graceEnd.getTime();
            if (overdueMs < 0) return;

            let spots = [];
            if (Array.isArray(reservation.reserved_spots)) {
                spots = reservation.reserved_spots;
            } else {
                try {
                    spots = JSON.parse(reservation.reserved_spots || '[]');
                } catch {
                    spots = [];
                }
            }

            spots
                .map((spot) => parseInt(spot, 10))
                .filter((spot) => !Number.isNaN(spot))
                .forEach((spotId) => {
                    const slot = parkingSlots.find((parkingSlot) => parkingSlot.id === spotId);
                    if (slot && slot.status === 'occupied') return;

                    const baseKey = `${reservation.id}-${spotId}`;
                    const userStageKey = `${baseKey}-user-30m`;
                    const escalationStageKey = `${baseKey}-personnel-35m`;

                    if (overdueMs < escalationDelayMs && !userNotif.includes(userStageKey)) {
                        userNotif.push(userStageKey);
                        userChanged = true;
                        showInfo(`Reservation for spot ${spotId} reached 30 minutes. If already parked, change it to Park now. If you will not show up, please release your reservation. Personnel escalation starts in 5 minutes.`, 2600);
                    }

                    if (overdueMs >= escalationDelayMs && !escalationNotif.includes(escalationStageKey)) {
                        escalationNotif.push(escalationStageKey);
                        escalationChanged = true;
                    }
                });
        });

        if (userChanged) {
            localStorage.setItem(userNotifKey, JSON.stringify(userNotif.slice(-400)));
        }
        if (escalationChanged) {
            localStorage.setItem('personnelEscalationNotifs', JSON.stringify(escalationNotif.slice(-500)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parkingSlots, userReservations, user, timeTick]);

    useEffect(() => {
        if (!Array.isArray(userReservations) || userReservations.length === 0 || parkingSlots.length === 0) {
            return;
        }

        const now = new Date();
        const approvedReservations = userReservations.filter((reservation) => {
            if ((reservation.status || '').toLowerCase() !== 'approved') return false;
            const reservedAt = new Date(reservation.reserved_for_datetime);
            return !Number.isNaN(reservedAt.getTime());
        });

        if (approvedReservations.length === 0) return;

        const updatesBySlot = new Map();

        const getReservationPriority = (reservedAtIso) => {
            const reservedAt = new Date(reservedAtIso);
            if (Number.isNaN(reservedAt.getTime())) {
                return { rank: -1, timeValue: 0 };
            }

            const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
            if (now > graceEnd) {
                return { rank: 3, timeValue: reservedAt.getTime() };
            }
            if (now >= reservedAt) {
                return { rank: 2, timeValue: reservedAt.getTime() };
            }
            // Upcoming gets the lowest priority; nearer upcoming time wins.
            return { rank: 1, timeValue: -reservedAt.getTime() };
        };

        approvedReservations.forEach((reservation) => {
            const reservedAtIso = reservation.reserved_for_datetime || null;
            const reservedSticker = (reservation.sticker_id || '').trim().toUpperCase();
            const nextPriority = getReservationPriority(reservedAtIso);

            let spots = [];
            if (Array.isArray(reservation.reserved_spots)) {
                spots = reservation.reserved_spots;
            } else {
                try {
                    spots = JSON.parse(reservation.reserved_spots || '[]');
                } catch {
                    spots = [];
                }
            }

            spots
                .map((spotId) => parseInt(spotId, 10))
                .filter((spotId) => !Number.isNaN(spotId))
                .forEach((spotId) => {
                    const current = updatesBySlot.get(spotId);
                    const shouldReplace = !current
                        || nextPriority.rank > current.priority.rank
                        || (nextPriority.rank === current.priority.rank && nextPriority.timeValue > current.priority.timeValue);

                    if (!shouldReplace) return;

                    updatesBySlot.set(spotId, {
                        reservedFor: reservedAtIso,
                        reservedStickerId: reservedSticker,
                        priority: nextPriority
                    });
                });
        });

        if (updatesBySlot.size === 0) return;

        let changed = false;
        const syncedSlots = parkingSlots.map((slot) => {
            const update = updatesBySlot.get(slot.id);
            if (slot.status === 'occupied') return slot;

            if (update) {
                const nextReservedFor = update.reservedFor || null;
                const nextReservedSticker = update.reservedStickerId || '';
                if (slot.reservedFor === nextReservedFor && slot.reservedStickerId === nextReservedSticker) {
                    return slot;
                }
                changed = true;
                return {
                    ...slot,
                    reservedFor: nextReservedFor,
                    reservedStickerId: nextReservedSticker
                };
            }

            if (slot.reservedFor || slot.reservedStickerId) {
                changed = true;
                return {
                    ...slot,
                    reservedFor: null,
                    reservedStickerId: ''
                };
            }

            return slot;
        });

        if (changed) {
            setParkingSlots(syncedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(syncedSlots));
        }
    }, [userReservations, parkingSlots]);

    /**
     * Mark all notifications as read for the current user.
     */
    const markAsRead = async () => {
        const unreadReservationKeys = unreadReservationStatusNotifs.map((notif) => notif.key);
        try {
            await axios.post(`${API_BASE_URL}/mark-notifications-read/`, {
                username: user.username,
                auth_token: user.authToken || ''
            });
            fetchUserRecords(user.username);
        } catch (err) {
            console.error("Could not mark as read:", err);
        }

        if (user?.username && unreadReservationKeys.length > 0) {
            const readStorageKey = `reservationStatusNotifRead_${user.username}`;
            const mergedReadKeys = [...new Set([...readReservationNotifKeys, ...unreadReservationKeys])];
            setReadReservationNotifKeys(mergedReadKeys);
            localStorage.setItem(readStorageKey, JSON.stringify(mergedReadKeys));
        }
    };

    // 3. Update Profile Logic
    const handleUpdateProfile = async () => {
        try {
            const wantsPasswordChange = oldPassword || newPassword || confirmNewPassword;

            if (wantsPasswordChange) {
                if (!oldPassword || !newPassword || !confirmNewPassword) {
                    showError('Please fill old password, new password, and confirm new password.');
                    return;
                }

                if (!passwordRule.test(newPassword)) {
                    showError('New password must be at least 8 characters with at least one uppercase letter and one number.');
                    return;
                }

                if (!passwordRule.test(confirmNewPassword)) {
                    showError('Confirm password must be at least 8 characters with at least one uppercase letter and one number.');
                    return;
                }

                if (newPassword !== confirmNewPassword) {
                    showError('New password and confirm new password do not match.');
                    return;
                }
            }

            const updateData = {
                username: user.username,
                identifier: newIdentifier,
                auth_token: user.authToken || ''
            };
            
            if (wantsPasswordChange) {
                updateData.oldPassword = oldPassword.trim();
                updateData.password = newPassword.trim();
            }

            await axios.post(`${API_BASE_URL}/update-profile/`, updateData);
            
            if (wantsPasswordChange) {
                showSuccess("Password changed! Please log in again.");
                localStorage.removeItem('currentUser');
                navigate('/');
            } else {
                const updatedUser = { ...user, identifier: newIdentifier };
                localStorage.setItem('currentUser', JSON.stringify(updatedUser));
                setUser(updatedUser);
                showSuccess("Profile updated successfully!");
                setShowSettings(false);
            }
        } catch (err) {
            showError(err?.response?.data?.message || "Update failed. Check backend connection.");
        }
    };

    // 4. Submit Application
    const submitApp = async () => {
        const rawPlate = (plate || '').trim();
        if (!rawPlate) return showError("Please enter Plate Number.");
        if (/[a-z]/.test(rawPlate)) return showError('Uppercase only: please enter your plate number in uppercase letters.');
        const normalizedPlate = rawPlate.toUpperCase();
        if (!paymentMethod) return showError("Please select payment method.");
        if (!paymentReference.trim()) return showError("Please enter payment reference number.");

        const displayFullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
        const encPlate = encryptDES(normalizedPlate);
        const encOwner = encryptDES(displayFullName);
        
        try {
            await axios.post(`${API_BASE_URL}/submit-vehicle/`, {
                username: user.username,
                auth_token: user.authToken || '',
                ownerName: encOwner,
                plateNumber: encPlate,
                vehicleType: type,
                paymentMethod,
                paymentReference: paymentReference.trim()
            });
            showSuccess("Application Sent!");
            setPlate('');
            setPaymentMethod('GCash');
            setPaymentReference('');
            setShowPaymentModal(false);
            fetchUserRecords(user.username);
        } catch (err) {
            showError(err?.response?.data?.message || "Submission failed.");
        }
    };

    if (!user) return null;

    const normalizedRole = (user.role || '').toLowerCase();
    const isGuest = normalizedRole === 'guest' || normalizedRole === 'non-student';
    const roleLabel = isGuest ? 'NON-STUDENT' : (user.role?.toUpperCase() || 'USER');
    const displayFullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;

    return (
        <div className="center dashboard-bg full-bleed-layout">
            <div className="card dashboard-card full-bleed-card">
                
                <div className="header-banner">
                    <img src={ualogo} alt="UA Logo" />
                    <div>
                        <div className="brand-title">University of the Assumption</div>
                        <div className="brand-subtitle">UA Parking Portal</div>
                    </div>
                </div>

                <div className="topbar">
                    <div className="welcome-row">
                        <h2 style={{ margin: 0 }}>Welcome, <span style={{ color: '#1e40af' }}>{displayFullName}</span></h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <p className="subtitle" style={{ margin: 0 }}>UA Parking Portal •</p>
                            <span className={`role-badge ${isGuest ? 'guest-tag' : 'student-tag'}`}>
                                {roleLabel}
                            </span>
                        </div>
                    </div>

                    <div className="topbar-actions" style={{ alignItems: 'center', position: 'relative' }}>
                        <button className="btn-gray slim" onClick={() => setShowSettings(true)}>⚙️</button>

                        <button className="btn-gray slim bell-btn" onClick={() => setShowNotif(!showNotif)}>
                            🔔
                            {unreadNotificationCount > 0 && <span className="notif-count">{unreadNotificationCount}</span>}
                        </button>

                        {showNotif && (
                            <div className="notif-dropdown">
                                <h4>Recent Updates</h4>
                                {applicationNotifications.length === 0 && unreadReservationStatusNotifs.length === 0 ? (
                                    <p className="empty-notif">No new notifications.</p>
                                ) : (
                                    <>
                                        {applicationNotifications.slice().reverse().map((n, i) => (
                                            <div
                                                key={`app-${i}`}
                                                className={`notif-item ${n.is_seen ? 'is-read' : 'is-unread'}`}
                                                role="button"
                                                tabIndex={0}
                                                onClick={markAsRead}
                                                onKeyDown={(event) => event.key === 'Enter' && markAsRead()}
                                                title="Click to mark as read"
                                            >
                                                Vehicle <strong>{decryptData(n.plate_number)}</strong> has been
                                                <strong className={n.status === 'Approved' ? 'text-green' : 'text-red'}> {n.status}</strong>.
                                                {n.admin_notes && (
                                                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#475569' }}>
                                                        Note: {n.admin_notes}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {unreadReservationStatusNotifs.map((notif) => (
                                            <div
                                                key={notif.key}
                                                className="notif-item is-unread"
                                                role="button"
                                                tabIndex={0}
                                                onClick={markAsRead}
                                                onKeyDown={(event) => event.key === 'Enter' && markAsRead()}
                                                title="Click to mark as read"
                                            >
                                                Reservation <strong>#{notif.reservationId}</strong> changed from
                                                <strong style={{ color: '#b45309' }}> {notif.previousStatus || 'pending'}</strong> to
                                                <strong style={{ color: notif.nextStatus === 'approved' ? '#16a34a' : notif.nextStatus === 'denied' ? '#dc2626' : '#0f766e' }}> {notif.nextStatus}</strong>.
                                                {notif.adminNotes ? (
                                                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#475569' }}>
                                                        Note: {notif.adminNotes}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </>
                                )}
                                {unreadNotificationCount > 0 && (
                                    <button className="link-btn mark-read" onClick={markAsRead}>Mark as Read</button>
                                )}
                            </div>
                        )}

                        <button className="btn-blue slim" onClick={() => { localStorage.removeItem('currentUser'); navigate('/'); }}>
                            Logout
                        </button>
                    </div>
                </div>

                {/* SETTINGS MODAL POPUP */}
                {showSettings && (
                    <div className="modal-overlay">
                        <div className="modal-content card" style={{ maxWidth: '520px', width: '92%' }}>
                            <h3 style={{ marginTop: 0, color: '#ffffff' }}>Account Settings</h3>
                            <div style={{ textAlign: 'left', marginTop: '15px' }}>
                                <label className="small-label">Old Password</label>
                                <PasswordField
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    placeholder="Enter old password"
                                    wrapperStyle={{ marginBottom: '10px' }}
                                />

                                <label className="small-label">New Password</label>
                                <PasswordField
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Enter new password"
                                    wrapperStyle={{ marginBottom: '10px' }}
                                />

                                <label className="small-label">Confirm New Password</label>
                                <PasswordField
                                    value={confirmNewPassword}
                                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                                    placeholder="Confirm new password"
                                    wrapperStyle={{ marginBottom: '15px' }}
                                />

                                <hr style={{ border: '0.5px solid #e2e8f0', margin: '15px 0' }} />

                                {isGuest ? (
                                    <div>
                                        <label className="small-label">Reason for Account</label>
                                        <select value={newIdentifier} onChange={(e) => setNewIdentifier(e.target.value)}>
                                            <option value="">Select Reason</option>
                                            {!nonStudentReasons.includes(newIdentifier) && newIdentifier && (
                                                <option value={newIdentifier}>Current: {newIdentifier}</option>
                                            )}
                                            {nonStudentReasons.map(reason => (
                                                <option key={reason} value={reason}>{reason}</option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div>
                                            <label className="small-label">Student ID (Permanent)</label>
                                            <input type="text" value={user.identifier.split(' | ')[0]} disabled className="disabled-input" />
                                        </div>
                                        <div>
                                            <label className="small-label">Update Level</label>
                                            <select 
                                                value={newIdentifier.includes('Senior High') ? 'Senior High' : 'College'} 
                                                onChange={(e) => {
                                                    const idPart = user.identifier.split(' | ')[0];
                                                    setNewIdentifier(`${idPart} | ${e.target.value} - `);
                                                }}
                                            >
                                                <option value="Senior High">Senior High</option>
                                                <option value="College">College</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="small-label">Select Course/Strand</label>
                                            <select 
                                                onChange={(e) => {
                                                    const base = newIdentifier.split(' - ')[0];
                                                    setNewIdentifier(`${base} - ${e.target.value}`);
                                                }}
                                            >
                                                <option value="">-- Choose --</option>
                                                {(newIdentifier.includes('Senior High') ? strands : courses).map(item => (
                                                    <option key={item} value={item}>{item}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                <button className="btn-green" style={{ flex: 1, whiteSpace: 'nowrap' }} onClick={handleUpdateProfile}>Save Changes</button>
                                <button className="btn-gray" onClick={() => { setShowSettings(false); setOldPassword(''); setNewPassword(''); setConfirmNewPassword(''); }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentModal && (
                    <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
                        <div className="modal-content card" style={{ maxWidth: '560px', width: '94%', color: '#ffffff' }} onClick={(e) => e.stopPropagation()}>
                            <h3 style={{ marginTop: 0, color: '#ffffff' }}>Sticker Payment</h3>
                            <p style={{ marginBottom: '12px', color: '#ffffff' }}>
                                List of Payment Method:{' '}
                                <a
                                    href="https://bit.ly/ListOfPaymentMethod"
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#93c5fd' }}
                                >
                                    https://bit.ly/ListOfPaymentMethod
                                </a>
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div>
                                        <label className="small-label" style={{ color: '#ffffff' }}>Payment Method</label>
                                        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                            {paymentMethods.map(method => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="small-label" style={{ color: '#ffffff' }}>Reference Number</label>
                                        <input
                                            type="text"
                                            placeholder="Enter payment reference number"
                                            value={paymentReference}
                                            onChange={(e) => setPaymentReference(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ padding: '10px', borderRadius: '8px', background: '#1e3a8a', color: '#ffffff', fontSize: '13px' }}>
                                        Fee: {type === '2-Wheels' ? 'Php 1,000' : type === '4-Wheels' ? 'Php 2,000' : 'Php 3,000'}
                                    </div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                                <button className="btn-gray" style={{ width: '110px', flexShrink: 0 }} onClick={() => setShowPaymentModal(false)}>Back</button>
                                <button className="btn-green" style={{ flex: 1 }} onClick={submitApp}>Confirm Payment</button>
                            </div>
                        </div>
                    </div>
                )}

                    <ParkingManagement
                    user={user}
                    parkingSlots={parkingSlots}
                    setParkingSlots={setParkingSlots}
                    userReservations={userReservations}
                    records={records}
                    TOTAL_PARKING_SLOTS={TOTAL_PARKING_SLOTS}
                    parentActiveTab={activeTab}
                    setParentActiveTab={setActiveTab}
                    paymentMethods={paymentMethods}
                    displayFullName={displayFullName}
                    decryptData={decryptData}
                    fetchUserRecords={fetchUserRecords}
                    getValidUserStickers={getValidUserStickers}
                    getPlateFromSticker={getPlateFromSticker}
                    getReservationInfo={getReservationInfo}
                    formatDateTime={formatDateTime}
                    getSlotStatusText={getSlotStatusText}
                    getSlotTooltipText={getSlotTooltipText}
                    fetchUserReservations={fetchUserReservations}
                />
            </div>
        </div>
    );
}