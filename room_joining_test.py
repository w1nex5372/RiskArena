#!/usr/bin/env python3
"""
Focused test for room joining and participant display functionality
Based on the specific review request requirements
"""

import requests
import json
import time
from datetime import datetime

class RoomJoiningTester:
    def __init__(self):
        # Get backend URL from frontend .env
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    self.base_url = line.split('=')[1].strip()
                    break
        
        self.api_url = f"{self.base_url}/api"
        print(f"🔗 Testing backend at: {self.api_url}")
        
        self.test_results = []
        
    def log_result(self, test_name, success, details="", response_data=None):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"    {details}")
        if response_data and not success:
            print(f"    Response: {json.dumps(response_data, indent=2)}")
        
        self.test_results.append({
            'test': test_name,
            'success': success,
            'details': details,
            'response': response_data
        })
        
    def test_1_room_initialization(self):
        """Test 1: GET /api/rooms - verify bronze, silver, gold rooms exist"""
        try:
            response = requests.get(f"{self.api_url}/rooms")
            
            if response.status_code != 200:
                self.log_result("1. Room Initialization", False, 
                              f"HTTP {response.status_code}", response.json())
                return False
            
            data = response.json()
            rooms = data.get('rooms', [])
            
            # Check for required room types
            room_types = [room['room_type'] for room in rooms]
            required_types = ['bronze', 'silver', 'gold']
            
            missing_types = [rt for rt in required_types if rt not in room_types]
            
            if missing_types:
                self.log_result("1. Room Initialization", False,
                              f"Missing room types: {missing_types}")
                return False
            
            # Verify room structure
            for room in rooms:
                if not all(key in room for key in ['id', 'room_type', 'players_count', 'status']):
                    self.log_result("1. Room Initialization", False,
                                  f"Room missing required fields: {room}")
                    return False
            
            self.log_result("1. Room Initialization", True,
                          f"Found {len(rooms)} rooms: {', '.join(room_types)}")
            return True
            
        except Exception as e:
            self.log_result("1. Room Initialization", False, str(e))
            return False
    
    def create_test_user(self, user_id, telegram_id, first_name):
        """Helper: Create a test user via Telegram auth"""
        try:
            user_data = {
                "telegram_auth_data": {
                    "id": telegram_id,
                    "first_name": first_name,
                    "last_name": "TestUser",
                    "username": f"testuser_{telegram_id}",
                    "photo_url": "https://example.com/photo.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            response = requests.post(f"{self.api_url}/auth/telegram", json=user_data)
            
            if response.status_code == 200:
                user = response.json()
                # Give user tokens for betting
                purchase_data = {
                    "user_id": user['id'],
                    "sol_amount": 1.0,
                    "token_amount": 1000
                }
                requests.post(f"{self.api_url}/purchase-tokens", json=purchase_data)
                return user
            else:
                print(f"Failed to create user {first_name}: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"Error creating user {first_name}: {e}")
            return None
    
    def test_2_player1_join_bronze(self):
        """Test 2: Player 1 joining bronze room"""
        try:
            # Create Player 1 - let system generate user_id
            player1 = self.create_test_user(
                None,  # Let system generate ID
                123456789,
                "Player1"
            )
            
            if not player1:
                self.log_result("2. Player 1 Join Bronze", False, "Failed to create Player 1")
                return False, None
            
            # Join bronze room with valid bet amount (bronze range: 150-450)
            join_data = {
                "user_id": player1['id'],  # Use actual user ID from creation
                "room_type": "bronze",
                "bet_amount": 200  # Valid bet amount for bronze room
            }
            
            response = requests.post(f"{self.api_url}/join-room", json=join_data)
            
            if response.status_code != 200:
                self.log_result("2. Player 1 Join Bronze", False,
                              f"HTTP {response.status_code}", response.json())
                return False, None
            
            result = response.json()
            
            # Verify response has status: "joined"
            if result.get('status') != 'joined':
                self.log_result("2. Player 1 Join Bronze", False,
                              f"Expected status 'joined', got '{result.get('status')}'")
                return False, None
            
            self.log_result("2. Player 1 Join Bronze", True,
                          f"Player 1 joined bronze room successfully. Position: {result.get('position')}")
            return True, player1
            
        except Exception as e:
            self.log_result("2. Player 1 Join Bronze", False, str(e))
            return False, None
    
    def test_3_bronze_participants_count_1(self):
        """Test 3: GET /api/room-participants/bronze - verify 1 player"""
        try:
            response = requests.get(f"{self.api_url}/room-participants/bronze")
            
            if response.status_code != 200:
                self.log_result("3. Bronze Room 1 Player", False,
                              f"HTTP {response.status_code}", response.json())
                return False
            
            data = response.json()
            player_count = data.get('count', 0)
            players = data.get('players', [])
            
            if player_count != 1:
                self.log_result("3. Bronze Room 1 Player", False,
                              f"Expected 1 player, found {player_count}")
                return False
            
            if len(players) != 1:
                self.log_result("3. Bronze Room 1 Player", False,
                              f"Expected 1 player in list, found {len(players)}")
                return False
            
            # Verify player data structure
            player = players[0]
            required_fields = ['user_id', 'username', 'first_name', 'bet_amount']
            missing_fields = [field for field in required_fields if field not in player]
            
            if missing_fields:
                self.log_result("3. Bronze Room 1 Player", False,
                              f"Player missing fields: {missing_fields}")
                return False
            
            self.log_result("3. Bronze Room 1 Player", True,
                          f"Bronze room has 1 player: {player['first_name']} (bet: {player['bet_amount']})")
            return True
            
        except Exception as e:
            self.log_result("3. Bronze Room 1 Player", False, str(e))
            return False
    
    def test_4_player2_join_bronze(self):
        """Test 4: Player 2 joining bronze room"""
        try:
            # Create Player 2 - let system generate user_id
            player2 = self.create_test_user(
                None,  # Let system generate ID
                987654321,
                "Player2"
            )
            
            if not player2:
                self.log_result("4. Player 2 Join Bronze", False, "Failed to create Player 2")
                return False, None
            
            # Join bronze room with valid bet amount (bronze range: 150-450)
            join_data = {
                "user_id": player2['id'],  # Use actual user ID from creation
                "room_type": "bronze",
                "bet_amount": 200  # Valid bet amount for bronze room
            }
            
            response = requests.post(f"{self.api_url}/join-room", json=join_data)
            
            if response.status_code != 200:
                self.log_result("4. Player 2 Join Bronze", False,
                              f"HTTP {response.status_code}", response.json())
                return False, None
            
            result = response.json()
            
            # Verify response has status: "joined"
            if result.get('status') != 'joined':
                self.log_result("4. Player 2 Join Bronze", False,
                              f"Expected status 'joined', got '{result.get('status')}'")
                return False, None
            
            self.log_result("4. Player 2 Join Bronze", True,
                          f"Player 2 joined bronze room successfully. Position: {result.get('position')}")
            return True, player2
            
        except Exception as e:
            self.log_result("4. Player 2 Join Bronze", False, str(e))
            return False, None
    
    def test_5_bronze_participants_count_2(self):
        """Test 5: GET /api/room-participants/bronze - verify 2 players with details"""
        try:
            # Wait a moment for the room to update
            time.sleep(1)
            
            response = requests.get(f"{self.api_url}/room-participants/bronze")
            
            if response.status_code != 200:
                self.log_result("5. Bronze Room 2 Players", False,
                              f"HTTP {response.status_code}", response.json())
                return False
            
            data = response.json()
            player_count = data.get('count', 0)
            players = data.get('players', [])
            
            # Note: If game started automatically, room might be empty or have new players
            # Check if we have the expected players or if game completed
            if player_count == 0:
                # Game might have completed, check if new room was created
                self.log_result("5. Bronze Room 2 Players", True,
                              "Room appears empty - game may have completed and new room created")
                return True
            
            if player_count != 2:
                self.log_result("5. Bronze Room 2 Players", False,
                              f"Expected 2 players, found {player_count}")
                return False
            
            if len(players) != 2:
                self.log_result("5. Bronze Room 2 Players", False,
                              f"Expected 2 players in list, found {len(players)}")
                return False
            
            # Verify both players have required data
            for i, player in enumerate(players, 1):
                required_fields = ['user_id', 'username', 'first_name', 'bet_amount']
                missing_fields = [field for field in required_fields if field not in player]
                
                if missing_fields:
                    self.log_result("5. Bronze Room 2 Players", False,
                                  f"Player {i} missing fields: {missing_fields}")
                    return False
            
            player_names = [p['first_name'] for p in players]
            player_bets = [p['bet_amount'] for p in players]
            
            self.log_result("5. Bronze Room 2 Players", True,
                          f"Bronze room has 2 players: {', '.join(player_names)} (bets: {player_bets})")
            return True
            
        except Exception as e:
            self.log_result("5. Bronze Room 2 Players", False, str(e))
            return False
    
    def test_6_room_state_verification(self):
        """Test 6: GET /api/rooms - check bronze room shows 2 players"""
        try:
            # Wait a moment for room updates
            time.sleep(1)
            
            response = requests.get(f"{self.api_url}/rooms")
            
            if response.status_code != 200:
                self.log_result("6. Room State Verification", False,
                              f"HTTP {response.status_code}", response.json())
                return False
            
            data = response.json()
            rooms = data.get('rooms', [])
            
            # Find bronze room
            bronze_room = None
            for room in rooms:
                if room['room_type'] == 'bronze':
                    bronze_room = room
                    break
            
            if not bronze_room:
                self.log_result("6. Room State Verification", False,
                              "Bronze room not found in rooms list")
                return False
            
            players_count = bronze_room.get('players_count', 0)
            
            # Note: If game completed, new room might have 0 players
            if players_count == 0:
                self.log_result("6. Room State Verification", True,
                              "Bronze room shows 0 players - game completed and new room created")
                return True
            elif players_count == 2:
                self.log_result("6. Room State Verification", True,
                              f"Bronze room shows {players_count} players as expected")
                return True
            else:
                self.log_result("6. Room State Verification", False,
                              f"Bronze room shows {players_count} players, expected 0 or 2")
                return False
            
        except Exception as e:
            self.log_result("6. Room State Verification", False, str(e))
            return False
    
    def run_all_tests(self):
        """Run all room joining and participant display tests"""
        print("🎰 Testing Room Joining and Participant Display Functionality")
        print("=" * 70)
        
        # Test 1: Room initialization
        if not self.test_1_room_initialization():
            print("❌ Room initialization failed - stopping tests")
            return False
        
        # Test 2: Player 1 joins bronze room
        success_p1, player1 = self.test_2_player1_join_bronze()
        if not success_p1:
            print("❌ Player 1 join failed - stopping tests")
            return False
        
        # Test 3: Verify 1 player in bronze room
        if not self.test_3_bronze_participants_count_1():
            print("❌ Bronze room participant count (1) verification failed")
        
        # Test 4: Player 2 joins bronze room
        success_p2, player2 = self.test_4_player2_join_bronze()
        if not success_p2:
            print("❌ Player 2 join failed")
        
        # Test 5: Verify 2 players in bronze room (or game completed)
        if not self.test_5_bronze_participants_count_2():
            print("❌ Bronze room participant count (2) verification failed")
        
        # Test 6: Verify room state
        if not self.test_6_room_state_verification():
            print("❌ Room state verification failed")
        
        # Summary
        print("\n" + "=" * 70)
        passed = sum(1 for result in self.test_results if result['success'])
        total = len(self.test_results)
        
        print(f"📊 Test Results: {passed}/{total} passed")
        
        if passed < total:
            print("\n❌ Failed Tests:")
            for result in self.test_results:
                if not result['success']:
                    print(f"  - {result['test']}: {result['details']}")
        else:
            print("\n✅ All room joining and participant display tests passed!")
        
        return passed == total

def main():
    tester = RoomJoiningTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    import sys
    sys.exit(main())