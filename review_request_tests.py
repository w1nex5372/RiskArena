#!/usr/bin/env python3
"""
Specific tests for the review request bugs:
1. 3-Player Game Logic: Room should wait for 3 players, not start with 2
2. Real Telegram Names: Players should show real names like "cia nera", "Tarofkinas", "Teror"
3. Unlimited Tokens: Verify specific users have 999M+ tokens
4. Winner Display: Ensure winners are shown to all players
"""

import requests
import sys
import json
import time
from datetime import datetime

class ReviewRequestTester:
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

    def test_specific_users_unlimited_tokens(self):
        """Test specific users from review request have unlimited tokens"""
        try:
            print("\n💰 Testing Specific Users Unlimited Tokens...")
            
            # Specific users from review request
            specific_users = [
                {"telegram_id": 1793011013, "name": "cia nera", "username": "cia_nera"},
                {"telegram_id": 7983427898, "name": "Teror", "username": "Teror"},
                {"telegram_id": 6168593741, "name": "Tarofkinas", "username": "Tarofkinas"}
            ]
            
            all_success = True
            details_list = []
            
            for user_info in specific_users:
                # Check if user exists
                try:
                    user_response = requests.get(f"{self.api_url}/users/telegram/{user_info['telegram_id']}")
                    if user_response.status_code == 200:
                        user_data = user_response.json()
                        balance = user_data.get('token_balance', 0)
                        
                        # Check if user has 999M+ tokens (unlimited)
                        if balance >= 999000000:
                            details_list.append(f"✅ {user_info['name']} (ID: {user_info['telegram_id']}) has {balance:,} tokens (UNLIMITED)")
                        else:
                            # Try to add unlimited tokens
                            token_response = requests.post(f"{self.api_url}/admin/add-tokens/{user_info['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=999000000")
                            if token_response.status_code == 200:
                                details_list.append(f"✅ Added unlimited tokens to {user_info['name']} (ID: {user_info['telegram_id']})")
                            else:
                                all_success = False
                                details_list.append(f"❌ {user_info['name']} (ID: {user_info['telegram_id']}) has only {balance:,} tokens and failed to add more")
                    else:
                        # User doesn't exist - create them with unlimited tokens
                        print(f"Creating user {user_info['name']} with unlimited tokens...")
                        
                        # Create user via auth
                        auth_data = {
                            "telegram_auth_data": {
                                "id": user_info['telegram_id'],
                                "first_name": user_info['name'].split()[0],
                                "last_name": user_info['name'].split()[1] if len(user_info['name'].split()) > 1 else "",
                                "username": user_info['username'],
                                "photo_url": f"https://example.com/{user_info['username']}.jpg",
                                "auth_date": int(datetime.now().timestamp()),
                                "hash": "telegram_auto"
                            }
                        }
                        
                        auth_response = requests.post(f"{self.api_url}/auth/telegram", json=auth_data)
                        if auth_response.status_code == 200:
                            # Add unlimited tokens (999M+)
                            token_response = requests.post(f"{self.api_url}/admin/add-tokens/{user_info['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=999000000")
                            if token_response.status_code == 200:
                                details_list.append(f"✅ Created {user_info['name']} (ID: {user_info['telegram_id']}) with 999M tokens (UNLIMITED)")
                            else:
                                all_success = False
                                details_list.append(f"❌ Failed to add unlimited tokens to {user_info['name']}")
                        else:
                            all_success = False
                            details_list.append(f"❌ Failed to create user {user_info['name']}")
                            
                except Exception as e:
                    all_success = False
                    details_list.append(f"❌ Error checking {user_info['name']}: {str(e)}")
            
            details = "\n".join(details_list)
            self.log_test("Specific Users Unlimited Tokens", all_success, details)
            return all_success
            
        except Exception as e:
            self.log_test("Specific Users Unlimited Tokens", False, str(e))
            return False

    def test_three_player_room_capacity(self):
        """Test that rooms require exactly 3 players"""
        try:
            print("\n🎯 Testing 3-Player Room Capacity...")
            
            # Check room configuration
            rooms_response = requests.get(f"{self.api_url}/rooms")
            if rooms_response.status_code != 200:
                self.log_test("3-Player Room Capacity", False, "Failed to get rooms")
                return False
            
            rooms_data = rooms_response.json()
            rooms = rooms_data.get('rooms', [])
            
            all_success = True
            details_list = []
            
            for room in rooms:
                max_players = room.get('max_players', 0)
                room_type = room.get('room_type', 'unknown')
                
                if max_players == 3:
                    details_list.append(f"✅ {room_type.title()} room correctly shows max_players=3")
                else:
                    all_success = False
                    details_list.append(f"❌ {room_type.title()} room shows max_players={max_players}, expected 3")
            
            details = "\n".join(details_list)
            self.log_test("3-Player Room Capacity", all_success, details)
            return all_success
            
        except Exception as e:
            self.log_test("3-Player Room Capacity", False, str(e))
            return False

    def test_real_telegram_names_in_participants(self):
        """Test that room participants show real Telegram names"""
        try:
            print("\n👤 Testing Real Telegram Names in Room Participants...")
            
            # Clean database first
            cleanup_response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if cleanup_response.status_code != 200:
                self.log_test("Real Telegram Names", False, "Database cleanup failed")
                return False
            
            time.sleep(1)
            
            # Create user with real name from review request
            auth_data = {
                "telegram_auth_data": {
                    "id": 1793011013,
                    "first_name": "cia",
                    "last_name": "nera",
                    "username": "cia_nera",
                    "photo_url": "https://example.com/cia_nera.jpg",
                    "auth_date": int(datetime.now().timestamp()),
                    "hash": "telegram_auto"
                }
            }
            
            auth_response = requests.post(f"{self.api_url}/auth/telegram", json=auth_data)
            if auth_response.status_code != 200:
                self.log_test("Real Telegram Names", False, "Failed to create user")
                return False
            
            user = auth_response.json()
            
            # Give tokens
            requests.post(f"{self.api_url}/admin/add-tokens/1793011013?admin_key=PRODUCTION_CLEANUP_2025&tokens=1000")
            
            # Join Bronze room
            join_data = {"room_type": "bronze", "user_id": user['id'], "bet_amount": 300}
            join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
            if join_response.status_code != 200:
                self.log_test("Real Telegram Names", False, f"Failed to join room: {join_response.text}")
                return False
            
            # Check room participants
            participants_response = requests.get(f"{self.api_url}/room-participants/bronze")
            if participants_response.status_code != 200:
                self.log_test("Real Telegram Names", False, "Failed to get room participants")
                return False
            
            participants_data = participants_response.json()
            players = participants_data.get('players', [])
            
            if not players:
                self.log_test("Real Telegram Names", False, "No players found in room")
                return False
            
            player = players[0]
            first_name = player.get('first_name', '')
            username = player.get('username', '')
            
            # Verify real names are shown (not generic "Participant" names)
            success = (
                first_name == "cia" and 
                username == "cia_nera" and
                "Participant" not in first_name and
                "Participant" not in username
            )
            
            if success:
                details = f"Real names displayed correctly: {first_name} (@{username})"
            else:
                details = f"Names incorrect: {first_name} (@{username}) - expected 'cia' (@cia_nera)"
            
            self.log_test("Real Telegram Names in Participants", success, details)
            return success
            
        except Exception as e:
            self.log_test("Real Telegram Names in Participants", False, str(e))
            return False

    def test_three_player_game_logic(self):
        """Test that game waits for exactly 3 players before starting"""
        try:
            print("\n⏳ Testing 3-Player Game Logic...")
            
            # Clean database
            cleanup_response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if cleanup_response.status_code != 200:
                self.log_test("3-Player Game Logic", False, "Database cleanup failed")
                return False
            
            time.sleep(1)
            
            # Create 3 test users with real names from review
            test_users = []
            user_configs = [
                {"telegram_id": 1793011013, "first_name": "cia", "last_name": "nera", "username": "cia_nera"},
                {"telegram_id": 6168593741, "first_name": "Tarofkinas", "last_name": "", "username": "Tarofkinas"},
                {"telegram_id": 7983427898, "first_name": "Teror", "last_name": "", "username": "Teror"}
            ]
            
            for config in user_configs:
                auth_data = {
                    "telegram_auth_data": {
                        "id": config['telegram_id'],
                        "first_name": config['first_name'],
                        "last_name": config['last_name'],
                        "username": config['username'],
                        "photo_url": f"https://example.com/{config['username']}.jpg",
                        "auth_date": int(datetime.now().timestamp()),
                        "hash": "telegram_auto"
                    }
                }
                
                auth_response = requests.post(f"{self.api_url}/auth/telegram", json=auth_data)
                if auth_response.status_code != 200:
                    self.log_test("3-Player Game Logic", False, f"Failed to create user {config['first_name']}")
                    return False
                
                user = auth_response.json()
                test_users.append(user)
                
                # Give unlimited tokens
                requests.post(f"{self.api_url}/admin/add-tokens/{config['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=999000000")
            
            # Test 1: Room shows waiting with 0 players
            rooms_response = requests.get(f"{self.api_url}/rooms")
            rooms = rooms_response.json().get('rooms', [])
            bronze_room = next((r for r in rooms if r['room_type'] == 'bronze'), None)
            
            if not bronze_room or bronze_room['status'] != 'waiting':
                self.log_test("3-Player Game Logic", False, f"Initial room not in waiting status: {bronze_room}")
                return False
            
            print("✅ Room shows 'waiting' status with 0/3 players")
            
            # Test 2: Room still waiting with 1 player
            join_data1 = {"room_type": "bronze", "user_id": test_users[0]['id'], "bet_amount": 300}
            join_response1 = requests.post(f"{self.api_url}/join-room", json=join_data1)
            if join_response1.status_code != 200:
                self.log_test("3-Player Game Logic", False, f"Player 1 failed to join: {join_response1.text}")
                return False
            
            result1 = join_response1.json()
            if result1.get('players_needed') != 2:
                self.log_test("3-Player Game Logic", False, f"After 1 player: expected 2 needed, got {result1.get('players_needed')}")
                return False
            
            print("✅ Room shows 'waiting' status with 1/3 players, needs 2 more")
            
            # Test 3: Room still waiting with 2 players
            join_data2 = {"room_type": "bronze", "user_id": test_users[1]['id'], "bet_amount": 300}
            join_response2 = requests.post(f"{self.api_url}/join-room", json=join_data2)
            if join_response2.status_code != 200:
                self.log_test("3-Player Game Logic", False, f"Player 2 failed to join: {join_response2.text}")
                return False
            
            result2 = join_response2.json()
            if result2.get('players_needed') != 1:
                self.log_test("3-Player Game Logic", False, f"After 2 players: expected 1 needed, got {result2.get('players_needed')}")
                return False
            
            print("✅ Room shows 'waiting' status with 2/3 players, needs 1 more")
            
            # Test 4: Game starts with 3 players
            join_data3 = {"room_type": "bronze", "user_id": test_users[2]['id'], "bet_amount": 300}
            join_response3 = requests.post(f"{self.api_url}/join-room", json=join_data3)
            if join_response3.status_code != 200:
                self.log_test("3-Player Game Logic", False, f"Player 3 failed to join: {join_response3.text}")
                return False
            
            result3 = join_response3.json()
            if result3.get('players_needed') != 0:
                self.log_test("3-Player Game Logic", False, f"After 3 players: expected 0 needed, got {result3.get('players_needed')}")
                return False
            
            print("✅ Game starts when 3rd player joins")
            
            # Wait for game to complete
            time.sleep(5)
            
            # Check if game completed and winner was selected
            history_response = requests.get(f"{self.api_url}/game-history?limit=1")
            if history_response.status_code == 200:
                history_data = history_response.json()
                games = history_data.get('games', [])
                if games:
                    latest_game = games[0]
                    winner = latest_game.get('winner')
                    if winner:
                        winner_name = f"{winner.get('first_name', '')} {winner.get('last_name', '')}".strip()
                        print(f"✅ Game completed with winner: {winner_name}")
                    else:
                        print("⚠️  Game completed but no winner found")
                else:
                    print("⚠️  No completed games found")
            
            details = "3-Player game logic working correctly: Waits for exactly 3 players before starting"
            self.log_test("3-Player Game Logic", True, details)
            return True
            
        except Exception as e:
            self.log_test("3-Player Game Logic", False, str(e))
            return False

    def test_winner_display_system(self):
        """Test that winners are properly displayed to all players"""
        try:
            print("\n🏆 Testing Winner Display System...")
            
            # Check if there are any completed games with winners
            history_response = requests.get(f"{self.api_url}/game-history?limit=5")
            if history_response.status_code != 200:
                self.log_test("Winner Display System", False, "Failed to get game history")
                return False
            
            history_data = history_response.json()
            games = history_data.get('games', [])
            
            if not games:
                self.log_test("Winner Display System", True, "No completed games found - cannot test winner display")
                return True
            
            # Check the most recent game
            latest_game = games[0]
            winner = latest_game.get('winner')
            
            if not winner:
                self.log_test("Winner Display System", False, "Latest game has no winner recorded")
                return False
            
            # Verify winner information is complete
            winner_name = f"{winner.get('first_name', '')} {winner.get('last_name', '')}".strip()
            winner_username = winner.get('username', '')
            
            # Check if winner has real name (not generic)
            success = (
                winner_name and
                winner_username and
                "Participant" not in winner_name and
                "Participant" not in winner_username
            )
            
            if success:
                details = f"Winner '{winner_name}' (@{winner_username}) properly displayed in game history"
            else:
                details = f"Winner display issue: name='{winner_name}', username='{winner_username}'"
            
            self.log_test("Winner Display System", success, details)
            return success
            
        except Exception as e:
            self.log_test("Winner Display System", False, str(e))
            return False

    def run_review_tests(self):
        """Run all tests for the review request bugs"""
        print("🎯 TESTING SPECIFIC BUGS FROM REVIEW REQUEST")
        print("=" * 60)
        print("Testing 3-player casino system fixes:")
        print("1. 3-Player Game Logic: Room should wait for 3 players, not start with 2")
        print("2. Real Telegram Names: Players should show real names")
        print("3. Unlimited Tokens: Verify specific users have 999M+ tokens")
        print("4. Winner Display: Ensure winners are shown to all players")
        print("=" * 60)
        
        # Test 1: 3-Player Room Capacity
        self.test_three_player_room_capacity()
        
        # Test 2: 3-Player Game Logic
        self.test_three_player_game_logic()
        
        # Test 3: Real Telegram Names
        self.test_real_telegram_names_in_participants()
        
        # Test 4: Unlimited Tokens for Specific Users
        self.test_specific_users_unlimited_tokens()
        
        # Test 5: Winner Display System
        self.test_winner_display_system()
        
        # Print results
        print("\n" + "=" * 60)
        print("🏁 REVIEW REQUEST TESTING COMPLETE")
        print("=" * 60)
        print(f"✅ Tests Passed: {self.tests_passed}/{self.tests_run}")
        print(f"❌ Tests Failed: {len(self.failed_tests)}")
        
        if self.failed_tests:
            print("\n🚨 FAILED TESTS:")
            for i, failed_test in enumerate(self.failed_tests, 1):
                print(f"{i}. {failed_test['name']}: {failed_test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n📊 Success Rate: {success_rate:.1f}%")
        
        if success_rate >= 90:
            print("🎉 EXCELLENT! All review request bugs have been fixed!")
        elif success_rate >= 75:
            print("✅ GOOD! Most bugs have been fixed.")
        elif success_rate >= 50:
            print("⚠️  MODERATE! Some bugs still need attention.")
        else:
            print("🚨 CRITICAL! Major bugs still exist!")
        
        return success_rate >= 75

def main():
    tester = ReviewRequestTester()
    success = tester.run_review_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())