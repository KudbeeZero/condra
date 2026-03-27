import Map "mo:core/Map";
import Array "mo:core/Array";
import List "mo:core/List";
import OutCall "http-outcalls/outcall";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import Runtime "mo:core/Runtime";

actor {
  let apiKey = "sk_b2fbfcc7d1faa5a09cb9ba1f6aaaa483809cbf9b3a75abd6";
  let voiceId = "VJwFZoxTZo5aI0IowiXA";
  let progressStorage = Map.empty<Text, PlayerProgress>();

  type PlayerProgress = {
    currentStage : Nat;
    totalKills : Nat;
    upgradeChoices : Text;
  };

  type HighScore = {
    playerName : Text;
    score : Nat;
  };

  let highScores = List.empty<HighScore>();
  let maxScores = 10;

  module HighScore {
    public func compare(a : HighScore, b : HighScore) : Order.Order {
      Nat.compare(b.score, a.score); // Descending order
    };
  };

  func getTopScores() : [HighScore] {
    var scoresArray = highScores.toArray().sort();
    if (scoresArray.size() > maxScores) {
      let shortened = scoresArray.sliceToArray(0, maxScores);
      return shortened;
    };
    scoresArray;
  };

  type ElevenLabsRequest = {
    text : Text;
  };

  type ElevenLabsResponse = {
    audio : Blob;
  };

  type Header = {
    name : Text;
    value : Text;
  };

  public query ({ caller }) func transform(input : OutCall.TransformationInput) : async OutCall.TransformationOutput {
    OutCall.transform(input);
  };

  func makeGetOutcall(url : Text) : async Text {
    await OutCall.httpGetRequest(url, [], transform);
  };

  func makePostOutcall(url : Text, headers : [Header], body : Text) : async Text {
    await OutCall.httpPostRequest(url, headers, body, transform);
  };

  func getUrl(voiceId : Text) : Text {
    "https://api.elevenlabs.io/v1/text-to-speech/" # voiceId # "/stream";
  };

  public shared ({ caller }) func getNarration(text : Text) : async Text {
    let url = getUrl(voiceId);
    let headers = [
      {
        name = "accept";
        value = "audio/mpeg";
      },
      {
        name = "xi-api-key";
        value = apiKey;
      },
    ];
    let audio = await makePostOutcall(url, headers, text);
    audio;
  };

  public shared ({ caller }) func submitScore(playerName : Text, score : Nat) : async () {
    let newScore : HighScore = {
      playerName;
      score;
    };
    highScores.add(newScore);
  };

  public query ({ caller }) func getLeaderboard() : async [HighScore] {
    getTopScores();
  };

  public shared ({ caller }) func saveProgress(sessionId : Text, progress : PlayerProgress) : async () {
    progressStorage.add(sessionId, progress);
  };

  public query ({ caller }) func getProgress(sessionId : Text) : async ?PlayerProgress {
    progressStorage.get(sessionId);
  };
};
