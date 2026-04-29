#!/usr/bin/env python3
"""
Focused test for 3-player casino system
Tests the specific requirements from the review request
"""

import requests
import sys
import json
import time
from datetime import datetime

class ThreePlayerSystemTester:
    def __init__(self, base_url="https://telebet-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED: {details}")

    def clean_database(self):
        """Clean database for fresh testing"""
        try:
            response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if response.status_code == 200:
                print("🧹 Database cleaned successfully")
                time.sleep(2)  # Wait for rooms to be reinitialized
                return True
            else:
                print(f"❌ Database cleanup failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Database cleanup error: {e}")
            return False

    def create_test_user(self, telegram_id, first_name, username):
        """Create a test user with specific telegram_id"""
        try:
            user_data = {
                "telegram_auth_data": {
                    "id": telegram_id,
                    "first_name": first_name,
                    "last_name": "Test",
                    "username": username,
                    "photo_url": f"https://example.com/{username}.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            response = requests.post(f"{self.api_url}/auth/telegram", json=user_data)
            if response.status_code == 200:
                user = response.json()
                
                # Give user tokens for testing
                token_response = requests.post(f"{self.api_url}/admin/add-tokens/{telegram_id}?admin_key=PRODUCTION_CLEANUP_2025&tokens=1000")
                
                print(f"✅ Created user: {first_name} (telegram_id: {telegram_id})")
                return user
            else:
                print(f"❌ Failed to create user {first_name}: {response.status_code}")
                return None
        except Exception as e:
            print(f"❌ Error creating user {first_name}: {e}")
            return None

    def test_room_capacity_api(self):
        """Test that GET /api/rooms shows max_players: 3"""
        try:
            response = requests.get(f"{self.api_url}/rooms")
            if response.status_code != 200:
                self.log_test("Room Capacity API", False, f"API call failed: {response.status_code}")
                return False
            
            data = response.json()
            rooms = data.get('rooms', [])
            
            if not rooms:
                self.log_test("Room Capacity API", False, "No rooms found")
                return False
            
            for room in rooms:
                max_players = room.get('max_players', 0)
                if max_players != 3:
                    self.log_test("Room Capacity API", False, f"Room {room['room_type']} has max_players={max_players}, expected 3")
                    return False
            
            self.log_test("Room Capacity API", True, f"All {len(rooms)} rooms correctly show max_players=3")
            return True
            
        except Exception as e:
            self.log_test("Room Capacity API", False, str(e))
            return False

    def test_room_status_progression(self):
        """Test room status progression: 0/3 → 1/3 → 2/3 → 3/3 (full)"""
        try:
            print("\n📊 Testing Room Status Progression...")
            
            # Clean database first
            if not self.clean_database():
                self.log_test("Room Status Progression", False, "Database cleanup failed")
                return False
            
            # Create 3 test users using the specific telegram_ids from review request
            telegram_ids = [123456789, 6168593741, 1793011013]
            users = []
            
            for i, telegram_id in enumerate(telegram_ids):
                user = self.create_test_user(telegram_id, f"Player{i+1}", f"player{i+1}")
                if not user:
                    self.log_test("Room Status Progression", False, f"Failed to create user {i+1}")
                    return False
                users.append(user)
            
            # Check initial state (0/3)
            rooms_response = requests.get(f"{self.api_url}/rooms")
            if rooms_response.status_code != 200:
                self.log_test("Room Status Progression", False, "Failed to get initial rooms")
                return False
            
            initial_rooms = rooms_response.json().get('rooms', [])
            bronze_room = next((r for r in initial_rooms if r['room_type'] == 'bronze'), None)
            if not bronze_room or bronze_room['players_count'] != 0:
                self.log_test("Room Status Progression", False, f"Initial Bronze room not empty: {bronze_room}")
                return False
            
            print(f"✅ Initial state: Bronze room 0/3 players")
            
            # Test progression: Player 1 joins (1/3)
            join_data1 = {"room_type": "bronze", "user_id": users[0]['id'], "bet_amount": 300}
            join_response1 = requests.post(f"{self.api_url}/join-room", json=join_data1)
            if join_response1.status_code != 200:
                self.log_test("Room Status Progression", False, f"Player 1 failed to join: {join_response1.text}")
                return False
            
            result1 = join_response1.json()
            if result1.get('position') != 1 or result1.get('players_needed') != 2:
                self.log_test("Room Status Progression", False, f"After player 1: position={result1.get('position')}, needed={result1.get('players_needed')}")
                return False
            
            print(f"✅ After Player 1: 1/3 players, 2 needed")
            
            # Test progression: Player 2 joins (2/3)
            join_data2 = {"room_type": "bronze", "user_id": users[1]['id'], "bet_amount": 300}
            join_response2 = requests.post(f"{self.api_url}/join-room", json=join_data2)
            if join_response2.status_code != 200:
                self.log_test("Room Status Progression", False, f"Player 2 failed to join: {join_response2.text}")
                return False
            
            result2 = join_response2.json()
            if result2.get('position') != 2 or result2.get('players_needed') != 1:
                self.log_test("Room Status Progression", False, f"After player 2: position={result2.get('position')}, needed={result2.get('players_needed')}")
                return False
            
            print(f"✅ After Player 2: 2/3 players, 1 needed")
            
            # Test progression: Player 3 joins (3/3 - should trigger game)
            join_data3 = {"room_type": "bronze", "user_id": users[2]['id'], "bet_amount": 300}
            join_response3 = requests.post(f"{self.api_url}/join-room", json=join_data3)
            if join_response3.status_code != 200:
                self.log_test("Room Status Progression", False, f"Player 3 failed to join: {join_response3.text}")
                return False
            
            result3 = join_response3.json()
            if result3.get('position') != 3 or result3.get('players_needed') != 0:
                self.log_test("Room Status Progression", False, f"After player 3: position={result3.get('position')}, needed={result3.get('players_needed')}")
                return False
            
            print(f"✅ After Player 3: 3/3 players, 0 needed - Game should start")
            
            self.log_test("Room Status Progression", True, "Room status progression working correctly: 0/3 → 1/3 → 2/3 → 3/3 (game starts)")
            return True
            
        except Exception as e:
            self.log_test("Room Status Progression", False, str(e))
            return False

    def test_game_start_logic(self):
        """Test that game only starts when exactly 3 players join"""
        try:
            print("\n🎯 Testing Game Start Logic...")
            
            # Clean database
            if not self.clean_database():
                self.log_test("Game Start Logic", False, "Database cleanup failed")
                return False
            
            # Create 3 test users
            telegram_ids = [123456789, 6168593741, 1793011013]
            users = []
            
            for i, telegram_id in enumerate(telegram_ids):
                user = self.create_test_user(telegram_id, f"GamePlayer{i+1}", f"gameplayer{i+1}")
                if not user:
                    self.log_test("Game Start Logic", False, f"Failed to create user {i+1}")
                    return False
                users.append(user)
            
            # Test 1: Game doesn't start with 1 player
            join_data1 = {"room_type": "bronze", "user_id": users[0]['id'], "bet_amount": 300}
            requests.post(f"{self.api_url}/join-room", json=join_data1)
            
            time.sleep(1)  # Wait briefly
            
            rooms_response1 = requests.get(f"{self.api_url}/rooms")
            rooms1 = rooms_response1.json().get('rooms', [])
            bronze_room1 = next((r for r in rooms1 if r['room_type'] == 'bronze'), None)
            
            if not bronze_room1 or bronze_room1['status'] != 'waiting':
                self.log_test("Game Start Logic", False, f"Game started with 1 player! Room status: {bronze_room1['status'] if bronze_room1 else 'None'}")
                return False
            
            print("✅ Game correctly did NOT start with 1 player")
            
            # Test 2: Game doesn't start with 2 players
            join_data2 = {"room_type": "bronze", "user_id": users[1]['id'], "bet_amount": 300}
            requests.post(f"{self.api_url}/join-room", json=join_data2)
            
            time.sleep(1)  # Wait briefly
            
            rooms_response2 = requests.get(f"{self.api_url}/rooms")
            rooms2 = rooms_response2.json().get('rooms', [])
            bronze_room2 = next((r for r in rooms2 if r['room_type'] == 'bronze'), None)
            
            if not bronze_room2 or bronze_room2['status'] != 'waiting':
                self.log_test("Game Start Logic", False, f"Game started with 2 players! Room status: {bronze_room2['status'] if bronze_room2 else 'None'}")
                return False
            
            print("✅ Game correctly did NOT start with 2 players")
            
            # Test 3: Game starts with 3 players
            join_data3 = {"room_type": "bronze", "user_id": users[2]['id'], "bet_amount": 300}
            requests.post(f"{self.api_url}/join-room", json=join_data3)
            
            time.sleep(4)  # Wait for game to start and complete
            
            # Check if game started and completed (new room should be created)
            rooms_response3 = requests.get(f"{self.api_url}/rooms")
            rooms3 = rooms_response3.json().get('rooms', [])
            bronze_room3 = next((r for r in rooms3 if r['room_type'] == 'bronze'), None)
            
            # After game completion, a new empty room should exist
            if not bronze_room3 or bronze_room3['players_count'] != 0:
                self.log_test("Game Start Logic", False, f"Game did not complete properly. Room state: {bronze_room3}")
                return False
            
            print("✅ Game correctly started and completed with 3 players")
            
            self.log_test("Game Start Logic", True, "Game start logic working correctly: No start with 1-2 players, starts with exactly 3 players")
            return True
            
        except Exception as e:
            self.log_test("Game Start Logic", False, str(e))
            return False

    def test_fourth_player_prevention(self):
        """Test that room prevents 4th player from joining"""
        try:
            print("\n🚫 Testing 4th Player Prevention...")
            
            # Clean database
            if not self.clean_database():
                self.log_test("4th Player Prevention", False, "Database cleanup failed")
                return False
            
            # Create 4 test users
            telegram_ids = [123456789, 6168593741, 1793011013, 999888777]
            users = []
            
            for i, telegram_id in enumerate(telegram_ids):
                user = self.create_test_user(telegram_id, f"Player{i+1}", f"player{i+1}")
                if not user:
                    self.log_test("4th Player Prevention", False, f"Failed to create user {i+1}")
                    return False
                users.append(user)
            
            # Fill room with 3 players first
            for i in range(3):
                join_data = {"room_type": "bronze", "user_id": users[i]['id'], "bet_amount": 300}
                join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
                if join_response.status_code != 200:
                    self.log_test("4th Player Prevention", False, f"Player {i+1} failed to join: {join_response.text}")
                    return False
            
            print("✅ 3 players successfully joined Bronze room")
            
            # Wait a moment for game to potentially start
            time.sleep(2)
            
            # Try to add 4th player - should fail
            join_data4 = {"room_type": "bronze", "user_id": users[3]['id'], "bet_amount": 300}
            join_response4 = requests.post(f"{self.api_url}/join-room", json=join_data4)
            
            # Should fail with 400 status (room full) or 404 (no available room)
            success = join_response4.status_code in [400, 404]
            
            if success:
                error_response = join_response4.json() if join_response4.status_code == 400 else {"detail": "No available room"}
                details = f"Correctly prevented 4th player from joining. Status: {join_response4.status_code}, Error: {error_response.get('detail', 'Unknown error')}"
            else:
                details = f"4th player was allowed to join! Status: {join_response4.status_code}, Response: {join_response4.text}"
            
            self.log_test("4th Player Prevention", success, details)
            return success
            
        except Exception as e:
            self.log_test("4th Player Prevention", False, str(e))
            return False

    def test_room_participants_api(self):
        """Test GET /api/room-participants/{room_type} handles 3 players"""
        try:
            print("\n👥 Testing Room Participants API...")
            
            # Clean database
            if not self.clean_database():
                self.log_test("Room Participants API", False, "Database cleanup failed")
                return False
            
            # Create 3 test users
            telegram_ids = [123456789, 6168593741, 1793011013]
            users = []
            
            for i, telegram_id in enumerate(telegram_ids):
                user = self.create_test_user(telegram_id, f"Participant{i+1}", f"participant{i+1}")
                if not user:
                    self.log_test("Room Participants API", False, f"Failed to create user {i+1}")
                    return False
                users.append(user)
            
            # Test empty room first
            participants_response0 = requests.get(f"{self.api_url}/room-participants/bronze")
            if participants_response0.status_code != 200:
                self.log_test("Room Participants API", False, "Failed to get initial participants")
                return False
            
            participants0 = participants_response0.json()
            if participants0.get('count') != 0:
                self.log_test("Room Participants API", False, f"Expected 0 initial participants, got {participants0.get('count')}")
                return False
            
            print("✅ Initial state: 0 participants")
            
            # Add players one by one and test participant API
            for i in range(3):
                join_data = {"room_type": "bronze", "user_id": users[i]['id'], "bet_amount": 300}
                join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
                if join_response.status_code != 200:
                    self.log_test("Room Participants API", False, f"Player {i+1} failed to join: {join_response.text}")
                    return False
                
                # Check participants after each join
                participants_response = requests.get(f"{self.api_url}/room-participants/bronze")
                if participants_response.status_code != 200:
                    self.log_test("Room Participants API", False, f"Failed to get participants after player {i+1}")
                    return False
                
                participants = participants_response.json()
                expected_count = i + 1
                
                if participants.get('count') != expected_count:
                    # If count is 0, game might have started (expected after 3rd player)
                    if i == 2 and participants.get('count') == 0:
                        print("✅ After 3rd player: Game started, participants API returns 0 (expected)")
                        break
                    else:
                        self.log_test("Room Participants API", False, f"After player {i+1}: expected {expected_count} participants, got {participants.get('count')}")
                        return False
                
                print(f"✅ After Player {i+1}: {participants.get('count')} participants")
                
                # Verify player details
                players = participants.get('players', [])
                if len(players) != expected_count:
                    self.log_test("Room Participants API", False, f"Player count mismatch: API count={participants.get('count')}, players array length={len(players)}")
                    return False
            
            self.log_test("Room Participants API", True, "Room participants API correctly handles 3-player progression and game start")
            return True
            
        except Exception as e:
            self.log_test("Room Participants API", False, str(e))
            return False

    def test_winner_selection_three_players(self):
        """Test that winner selection works with 3 players"""
        try:
            print("\n🏆 Testing Winner Selection with 3 Players...")
            
            # Clean database
            if not self.clean_database():
                self.log_test("Winner Selection 3 Players", False, "Database cleanup failed")
                return False
            
            # Create 3 test users
            telegram_ids = [123456789, 6168593741, 1793011013]
            users = []
            
            for i, telegram_id in enumerate(telegram_ids):
                user = self.create_test_user(telegram_id, f"Winner{i+1}", f"winner{i+1}")
                if not user:
                    self.log_test("Winner Selection 3 Players", False, f"Failed to create user {i+1}")
                    return False
                users.append(user)
            
            # All 3 players join Bronze room
            for i in range(3):
                join_data = {"room_type": "bronze", "user_id": users[i]['id'], "bet_amount": 300}
                join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
                if join_response.status_code != 200:
                    self.log_test("Winner Selection 3 Players", False, f"Player {i+1} failed to join: {join_response.text}")
                    return False
            
            print("✅ All 3 players joined Bronze room")
            
            # Wait for game to complete
            time.sleep(5)
            
            # Check if any user has won prizes
            total_prizes = 0
            winner_found = False
            
            for i, user in enumerate(users):
                prizes_response = requests.get(f"{self.api_url}/user/{user['id']}/prizes")
                if prizes_response.status_code == 200:
                    prizes = prizes_response.json().get('prizes', [])
                    total_prizes += len(prizes)
                    if len(prizes) > 0:
                        winner_found = True
                        print(f"✅ Winner found: Player {i+1} has {len(prizes)} prize(s)")
            
            if not winner_found:
                self.log_test("Winner Selection 3 Players", False, "No winner found after 3-player game")
                return False
            
            if total_prizes != 1:
                self.log_test("Winner Selection 3 Players", False, f"Expected exactly 1 winner, found {total_prizes} total prizes")
                return False
            
            self.log_test("Winner Selection 3 Players", True, f"Winner selection working correctly with 3 players - 1 winner selected")
            return True
            
        except Exception as e:
            self.log_test("Winner Selection 3 Players", False, str(e))
            return False

    def run_all_tests(self):
        """Run all 3-player system tests"""
        print("🎰 Testing 3-Player Casino System")
        print("=" * 50)
        
        # Test API connectivity first
        try:
            response = requests.get(f"{self.api_url}/")
            if response.status_code != 200:
                print("❌ API is not accessible, stopping tests")
                return False
            print("✅ API connectivity confirmed")
        except Exception as e:
            print(f"❌ API connectivity failed: {e}")
            return False
        
        # Run all 3-player system tests
        self.test_room_capacity_api()
        self.test_room_status_progression()
        self.test_game_start_logic()
        self.test_fourth_player_prevention()
        self.test_room_participants_api()
        self.test_winner_selection_three_players()
        
        # Summary
        print("\n" + "=" * 50)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"  - {test['name']}: {test['details']}")
        else:
            print("\n✅ All 3-player system tests passed!")
        
        return self.tests_passed == self.tests_run

def main():
    tester = ThreePlayerSystemTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())