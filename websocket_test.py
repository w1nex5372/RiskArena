import asyncio
import socketio
import requests
import json
import time
from datetime import datetime

class WebSocketRoomSyncTester:
    def __init__(self, base_url="https://telebet-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.sio1 = socketio.AsyncClient()
        self.sio2 = socketio.AsyncClient()
        self.test_user1 = None
        self.test_user2 = None
        self.events_received = []
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED: {details}")
        if details:
            print(f"   Details: {details}")

    def setup_event_handlers(self, client_name, sio_client):
        """Setup WebSocket event handlers"""
        
        @sio_client.event
        async def connect():
            print(f"🔌 {client_name} connected to WebSocket")
            self.events_received.append({
                'client': client_name,
                'event': 'connect',
                'timestamp': datetime.now().isoformat()
            })

        @sio_client.event
        async def disconnect():
            print(f"🔌 {client_name} disconnected from WebSocket")

        @sio_client.event
        async def rooms_updated(data):
            print(f"📡 {client_name} received rooms_updated: {len(data.get('rooms', []))} rooms")
            self.events_received.append({
                'client': client_name,
                'event': 'rooms_updated',
                'data': data,
                'timestamp': datetime.now().isoformat()
            })

        @sio_client.event
        async def player_joined(data):
            print(f"👤 {client_name} received player_joined: {data.get('player', {}).get('username', 'Unknown')} joined {data.get('room_type', 'Unknown')} room")
            self.events_received.append({
                'client': client_name,
                'event': 'player_joined',
                'data': data,
                'timestamp': datetime.now().isoformat()
            })

        @sio_client.event
        async def new_room_available(data):
            print(f"🏠 {client_name} received new_room_available: {data.get('room_type', 'Unknown')} room #{data.get('round_number', 'Unknown')}")
            self.events_received.append({
                'client': client_name,
                'event': 'new_room_available',
                'data': data,
                'timestamp': datetime.now().isoformat()
            })

        @sio_client.event
        async def game_starting(data):
            print(f"🎮 {client_name} received game_starting: {data.get('room_type', 'Unknown')} room with {len(data.get('players', []))} players")
            self.events_received.append({
                'client': client_name,
                'event': 'game_starting',
                'data': data,
                'timestamp': datetime.now().isoformat()
            })

        @sio_client.event
        async def game_finished(data):
            print(f"🏆 {client_name} received game_finished: Winner is {data.get('winner', {}).get('username', 'Unknown')}")
            self.events_received.append({
                'client': client_name,
                'event': 'game_finished',
                'data': data,
                'timestamp': datetime.now().isoformat()
            })

    async def create_test_users(self):
        """Create two test users via HTTP API"""
        try:
            # Create User 1
            user1_data = {
                "telegram_auth_data": {
                    "id": 987654321,
                    "first_name": "WebSocketUser1",
                    "last_name": "Tester",
                    "username": "wsuser1",
                    "photo_url": "https://example.com/photo1.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            response1 = requests.post(f"{self.api_url}/auth/telegram", json=user1_data)
            if response1.status_code == 200:
                self.test_user1 = response1.json()
                print(f"✅ Created User 1: {self.test_user1['first_name']} (ID: {self.test_user1['id']})")
            else:
                print(f"❌ Failed to create User 1: {response1.status_code}")
                return False

            # Create User 2
            user2_data = {
                "telegram_auth_data": {
                    "id": 987654322,
                    "first_name": "WebSocketUser2",
                    "last_name": "Tester",
                    "username": "wsuser2",
                    "photo_url": "https://example.com/photo2.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            response2 = requests.post(f"{self.api_url}/auth/telegram", json=user2_data)
            if response2.status_code == 200:
                self.test_user2 = response2.json()
                print(f"✅ Created User 2: {self.test_user2['first_name']} (ID: {self.test_user2['id']})")
            else:
                print(f"❌ Failed to create User 2: {response2.status_code}")
                return False

            # Give both users tokens
            for i, user in enumerate([self.test_user1, self.test_user2], 1):
                purchase_data = {
                    "user_id": user['id'],
                    "sol_amount": 1.0,
                    "token_amount": 1000
                }
                response = requests.post(f"{self.api_url}/purchase-tokens", json=purchase_data)
                if response.status_code == 200:
                    user['token_balance'] = 1000
                    print(f"✅ Gave User {i} 1000 tokens")
                else:
                    print(f"❌ Failed to give User {i} tokens")
                    return False

            return True
        except Exception as e:
            print(f"❌ Error creating test users: {e}")
            return False

    async def test_websocket_connections(self):
        """Test WebSocket connections"""
        try:
            # Setup event handlers
            self.setup_event_handlers("Client1", self.sio1)
            self.setup_event_handlers("Client2", self.sio2)
            
            # Connect both clients
            await self.sio1.connect(self.base_url)
            await self.sio2.connect(self.base_url)
            
            # Wait for connection events
            await asyncio.sleep(1)
            
            # Check if both clients connected
            connect_events = [e for e in self.events_received if e['event'] == 'connect']
            success = len(connect_events) == 2
            details = f"Connected {len(connect_events)}/2 WebSocket clients"
            
            self.log_test("WebSocket Connections", success, details)
            return success
        except Exception as e:
            self.log_test("WebSocket Connections", False, str(e))
            return False

    async def test_broadcast_room_updates(self):
        """Test the broadcast_room_updates function by triggering room state changes"""
        try:
            # Clear previous events
            initial_event_count = len(self.events_received)
            
            # Get initial room state via HTTP to compare
            response = requests.get(f"{self.api_url}/rooms")
            if response.status_code != 200:
                self.log_test("Broadcast Room Updates", False, "Failed to get initial room state")
                return False
            
            initial_rooms = response.json().get('rooms', [])
            bronze_rooms = [r for r in initial_rooms if r['room_type'] == 'bronze']
            
            if not bronze_rooms:
                self.log_test("Broadcast Room Updates", False, "No bronze rooms available")
                return False
            
            # Wait a moment to ensure we capture any initial broadcasts
            await asyncio.sleep(2)
            
            # Check if we received rooms_updated events
            rooms_updated_events = [e for e in self.events_received if e['event'] == 'rooms_updated']
            
            success = len(rooms_updated_events) > 0
            if success:
                latest_event = rooms_updated_events[-1]
                rooms_data = latest_event['data'].get('rooms', [])
                details = f"Received {len(rooms_updated_events)} rooms_updated events, latest contains {len(rooms_data)} rooms with timestamp"
                
                # Verify the data structure
                if rooms_data:
                    sample_room = rooms_data[0]
                    required_fields = ['id', 'room_type', 'players_count', 'status', 'max_players']
                    missing_fields = [field for field in required_fields if field not in sample_room]
                    if missing_fields:
                        details += f", Missing fields: {missing_fields}"
                        success = False
                    else:
                        details += ", All required fields present"
            else:
                details = "No rooms_updated events received"
            
            self.log_test("Broadcast Room Updates", success, details)
            return success
        except Exception as e:
            self.log_test("Broadcast Room Updates", False, str(e))
            return False

    async def test_real_time_player_joining(self):
        """Test real-time updates when players join rooms"""
        try:
            if not self.test_user1 or not self.test_user2:
                self.log_test("Real-time Player Joining", False, "Test users not available")
                return False
            
            # Clear events to focus on this test
            events_before = len(self.events_received)
            
            # User 1 joins Bronze room
            join_data1 = {
                "room_type": "bronze",
                "user_id": self.test_user1['id'],
                "bet_amount": 300
            }
            
            print("🎯 User 1 joining Bronze room...")
            response1 = requests.post(f"{self.api_url}/join-room", json=join_data1)
            if response1.status_code != 200:
                self.log_test("Real-time Player Joining", False, f"User 1 failed to join: {response1.status_code}")
                return False
            
            # Wait for WebSocket events
            await asyncio.sleep(2)
            
            # User 2 joins the same Bronze room (should trigger game start)
            join_data2 = {
                "room_type": "bronze",
                "user_id": self.test_user2['id'],
                "bet_amount": 300
            }
            
            print("🎯 User 2 joining Bronze room...")
            response2 = requests.post(f"{self.api_url}/join-room", json=join_data2)
            if response2.status_code != 200:
                self.log_test("Real-time Player Joining", False, f"User 2 failed to join: {response2.status_code}")
                return False
            
            # Wait for all WebSocket events (game start, finish, new room creation)
            await asyncio.sleep(6)
            
            # Analyze events received
            new_events = [e for e in self.events_received[events_before:]]
            player_joined_events = [e for e in new_events if e['event'] == 'player_joined']
            rooms_updated_events = [e for e in new_events if e['event'] == 'rooms_updated']
            game_starting_events = [e for e in new_events if e['event'] == 'game_starting']
            game_finished_events = [e for e in new_events if e['event'] == 'game_finished']
            new_room_events = [e for e in new_events if e['event'] == 'new_room_available']
            
            # Verify we got the expected events
            success = True
            details = []
            
            # Should have 2 player_joined events (one for each player)
            if len(player_joined_events) >= 2:
                details.append(f"✅ {len(player_joined_events)} player_joined events")
                # Verify player_joined events have updated player counts
                for event in player_joined_events:
                    if 'players_count' in event['data']:
                        details.append(f"   Player count: {event['data']['players_count']}")
                    else:
                        success = False
                        details.append("   ❌ Missing players_count in player_joined event")
            else:
                success = False
                details.append(f"❌ Expected 2+ player_joined events, got {len(player_joined_events)}")
            
            # Should have multiple rooms_updated events
            if len(rooms_updated_events) >= 2:
                details.append(f"✅ {len(rooms_updated_events)} rooms_updated events")
                # Verify rooms_updated events contain complete room data
                latest_rooms_event = rooms_updated_events[-1]
                if 'rooms' in latest_rooms_event['data'] and 'timestamp' in latest_rooms_event['data']:
                    details.append("   ✅ rooms_updated contains rooms array and timestamp")
                else:
                    success = False
                    details.append("   ❌ rooms_updated missing required data structure")
            else:
                success = False
                details.append(f"❌ Expected 2+ rooms_updated events, got {len(rooms_updated_events)}")
            
            # Should have game_starting event
            if len(game_starting_events) >= 1:
                details.append(f"✅ {len(game_starting_events)} game_starting events")
            else:
                success = False
                details.append(f"❌ Expected 1+ game_starting events, got {len(game_starting_events)}")
            
            # Should have game_finished event
            if len(game_finished_events) >= 1:
                details.append(f"✅ {len(game_finished_events)} game_finished events")
            else:
                success = False
                details.append(f"❌ Expected 1+ game_finished events, got {len(game_finished_events)}")
            
            # Should have new_room_available event after game completion
            if len(new_room_events) >= 1:
                details.append(f"✅ {len(new_room_events)} new_room_available events")
                # Verify new_room_available works with broadcasting
                for event in new_room_events:
                    if 'room_type' in event['data'] and 'round_number' in event['data']:
                        details.append(f"   New {event['data']['room_type']} room #{event['data']['round_number']}")
                    else:
                        success = False
                        details.append("   ❌ new_room_available missing required fields")
            else:
                success = False
                details.append(f"❌ Expected 1+ new_room_available events, got {len(new_room_events)}")
            
            self.log_test("Real-time Player Joining", success, "; ".join(details))
            return success
        except Exception as e:
            self.log_test("Real-time Player Joining", False, str(e))
            return False

    async def test_websocket_event_data_structure(self):
        """Test that WebSocket events contain proper data structures"""
        try:
            # Analyze all events received so far
            success = True
            details = []
            
            # Test rooms_updated event structure
            rooms_updated_events = [e for e in self.events_received if e['event'] == 'rooms_updated']
            if rooms_updated_events:
                latest_event = rooms_updated_events[-1]
                data = latest_event['data']
                
                # Check required fields
                if 'rooms' in data and 'timestamp' in data:
                    details.append("✅ rooms_updated has required fields (rooms, timestamp)")
                    
                    # Check room data structure
                    rooms = data['rooms']
                    if rooms:
                        sample_room = rooms[0]
                        required_room_fields = ['id', 'room_type', 'players_count', 'status', 'max_players', 'round_number']
                        missing_fields = [field for field in required_room_fields if field not in sample_room]
                        if not missing_fields:
                            details.append("✅ Room data contains all required fields")
                        else:
                            success = False
                            details.append(f"❌ Room data missing fields: {missing_fields}")
                    else:
                        details.append("⚠️ No room data to validate structure")
                else:
                    success = False
                    details.append("❌ rooms_updated missing required fields")
            else:
                success = False
                details.append("❌ No rooms_updated events to validate")
            
            # Test player_joined event structure
            player_joined_events = [e for e in self.events_received if e['event'] == 'player_joined']
            if player_joined_events:
                latest_event = player_joined_events[-1]
                data = latest_event['data']
                
                required_fields = ['room_id', 'room_type', 'player', 'players_count', 'prize_pool']
                missing_fields = [field for field in required_fields if field not in data]
                if not missing_fields:
                    details.append("✅ player_joined has all required fields")
                else:
                    success = False
                    details.append(f"❌ player_joined missing fields: {missing_fields}")
            else:
                details.append("⚠️ No player_joined events to validate")
            
            # Test game events structure
            game_events = [e for e in self.events_received if e['event'] in ['game_starting', 'game_finished']]
            if game_events:
                details.append(f"✅ Received {len(game_events)} game events with proper structure")
            else:
                details.append("⚠️ No game events to validate")
            
            self.log_test("WebSocket Event Data Structure", success, "; ".join(details))
            return success
        except Exception as e:
            self.log_test("WebSocket Event Data Structure", False, str(e))
            return False

    async def run_all_tests(self):
        """Run all WebSocket real-time synchronization tests"""
        print("🌐 Starting WebSocket Real-time Room Synchronization Tests...")
        print("=" * 70)
        
        # Create test users
        print("\n👥 Creating Test Users...")
        if not await self.create_test_users():
            print("❌ Failed to create test users, stopping tests")
            return False
        
        # Test WebSocket connections
        print("\n🔌 Testing WebSocket Connections...")
        if not await self.test_websocket_connections():
            print("❌ WebSocket connection failed, stopping tests")
            return False
        
        # Test broadcast_room_updates function
        print("\n📡 Testing Broadcast Room Updates Function...")
        await self.test_broadcast_room_updates()
        
        # Test real-time player joining and room synchronization
        print("\n🎯 Testing Real-time Player Joining & Room Sync...")
        await self.test_real_time_player_joining()
        
        # Test WebSocket event data structures
        print("\n📋 Testing WebSocket Event Data Structures...")
        await self.test_websocket_event_data_structure()
        
        # Cleanup
        await self.sio1.disconnect()
        await self.sio2.disconnect()
        
        # Summary
        print("\n" + "=" * 70)
        print(f"📊 WebSocket Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  - {test['name']}: {test['details']}")
        else:
            print("\n✅ All WebSocket tests passed!")
        
        # Show event summary
        print(f"\n📡 Total WebSocket Events Received: {len(self.events_received)}")
        event_types = {}
        for event in self.events_received:
            event_type = event['event']
            event_types[event_type] = event_types.get(event_type, 0) + 1
        
        for event_type, count in event_types.items():
            print(f"  - {event_type}: {count}")
        
        return self.tests_passed == self.tests_run

async def main():
    tester = WebSocketRoomSyncTester()
    try:
        success = await tester.run_all_tests()
        return 0 if success else 1
    except Exception as e:
        print(f"❌ Test execution failed: {e}")
        return 1
    finally:
        # Ensure cleanup
        try:
            if tester.sio1.connected:
                await tester.sio1.disconnect()
            if tester.sio2.connected:
                await tester.sio2.disconnect()
        except:
            pass

if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))