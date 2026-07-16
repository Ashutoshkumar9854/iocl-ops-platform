import { getQueuedMutations, clearMutation } from './db';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1';

/**
 * Syncs the local queue of mutations to the backend server.
 * Uses the saved user authentication token to authenticate requests.
 */
export async function syncOfflineQueue(authToken) {
  if (!authToken) {
    console.warn('Sync aborted: User is not authenticated');
    return { success: false, reason: 'unauthenticated' };
  }

  try {
    const mutations = await getQueuedMutations();
    if (mutations.length === 0) {
      return { success: true, count: 0 };
    }

    console.log(`Syncing ${mutations.length} queued offline mutations to server...`);

    const response = await fetch(`${API_BASE_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        device_fingerprint: 'DESKTOP-BROWSER-CLIENT',
        mutations: mutations
      })
    });

    if (!response.ok) {
      throw new Error(`Sync server responded with status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Sync result response:', result);

    const { results } = result;

    // Clear resolved mutations from IndexedDB
    for (const res of results) {
      if (res.status === 'SUCCESS') {
        await clearMutation(res.mutation_id);
      } else {
        console.error(`Failed to sync mutation ${res.mutation_id}:`, res.error);
      }
    }

    return {
      success: true,
      count: result.sync_summary.applied,
      conflicts: result.sync_summary.conflicts
    };
  } catch (error) {
    console.error('Offline synchronization failed:', error);
    return { success: false, reason: error.message };
  }
}
