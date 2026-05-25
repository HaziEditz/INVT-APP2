package com.khybertech.taxi360driver.Chat;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.AsyncTask;
import android.os.Handler;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.support.design.widget.CoordinatorLayout;
import android.support.design.widget.Snackbar;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.support.v7.widget.Toolbar;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.JobView;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;
//import com.onesignal.OSNotification;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class ChatActivity extends AppCompatActivity  {

    RecyclerView recyclerView_chatActivity;
    RecyclerView.Adapter recyclerView_adapter;
    RecyclerView.LayoutManager recyclerView_layoutManager;
    StringRequest  postRequest;
    String senderId;
    int driverId;
    List<String> messages,mtime,mName;
    List<Integer> keys;
    SecurePreferences pref;
    ImageView iv_sendmessage_chat;
    EditText etxt_sendmessage_chat;
    String message_tobe_sent,date_tobe_sent,username,player_id;
    Toolbar toolbar_chat_conversation;
    CoordinatorLayout layout_snakcbar;
    LinearLayout pd;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chat);
        Intent intent = getIntent();
//        OneSignal.startInit(this).inFocusDisplaying(OneSignal.OSInFocusDisplayOption.None).setNotificationReceivedHandler(this).init();
        recyclerView_chatActivity = (RecyclerView) findViewById(R.id.recyclerView_chat);
        etxt_sendmessage_chat = (EditText) findViewById(R.id.etxt_sendmessage_chat);
        iv_sendmessage_chat = (ImageView) findViewById(R.id.iv_sendmessage_chat);
        toolbar_chat_conversation = (Toolbar) findViewById(R.id.toolbar_chat_conversation);
        layout_snakcbar = (CoordinatorLayout) findViewById(R.id.layout_snakcbar);
        recyclerView_chatActivity.setHasFixedSize(true);
//        pref = PreferenceManager.getDefaultSharedPreferences(ChatActivity.this);
        pref = appcontext.getInstance().pref;
        driverId = Integer.parseInt(appcontext.getInstance().DriverId);//Integer.parseInt(pref.getString("user_id"));
        senderId = intent.getExtras().getString("id","null");
        username = intent.getExtras().getString("name","null");
        player_id = intent.getExtras().getString("player_id","null");
        Log.e("playerid",player_id);
        toolbar_chat_conversation.setTitle(username);
        toolbar_chat_conversation.setNavigationIcon(R.drawable.back_icon);
        toolbar_chat_conversation.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                try {
                    postRequest.cancel();
                }catch (Exception e){

                }

                onBackPressed();
            }
        });
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {

                //  new loadChat().execute();
            }
        },500);
        recyclerView_layoutManager = new LinearLayoutManager(ChatActivity.this);
        recyclerView_chatActivity.setLayoutManager(recyclerView_layoutManager);
       if(pref.getString("chatdataid"+senderId).equalsIgnoreCase("1")){
           pd = (LinearLayout)findViewById(R.id.loadingbar);
           loadchatdata(pref.getString("chatdata"+senderId));
         //  Toast.makeText(this, "found"+pref.getString("chatdata",null), Toast.LENGTH_SHORT).show();
       }else{
           Loadchatrequest();
       }



       // new loadChat().execute();
        etxt_sendmessage_chat.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence charSequence, int i, int i1, int i2) {

            }

            @Override
            public void onTextChanged(CharSequence charSequence, int start, int count, int after) {
                if (after != 0){
                    iv_sendmessage_chat.setVisibility(View.VISIBLE);
                }
                else {
                    iv_sendmessage_chat.setVisibility(View.GONE);
                }
                Log.e("txt",""+start);
                Log.e("txt",""+count);
                Log.e("txt",""+after);
            }

            @Override
            public void afterTextChanged(Editable editable) {

            }
        });
        iv_sendmessage_chat.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                message_tobe_sent = etxt_sendmessage_chat.getText().toString();
                Calendar c = Calendar.getInstance();
                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
                String currentDateTime = format.format(c.getTime());
                SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
                try {
                    Date fullDate = toFullDate.parse(currentDateTime);
                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM/dd/yyyy");
                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("k:mm a");
                    String dateOnly = dateOnlyDate.format(fullDate);
                    String TimeOnly = timeOnlyTime.format(fullDate);
                    date_tobe_sent = dateOnly+" "+TimeOnly;
                    Log.e("error",dateOnly + TimeOnly);
                } catch (ParseException e) {
                    Log.e("error",e.getMessage());
                }
                if (messages==null){
                    messages = new ArrayList<>();
                    mName = new ArrayList<>();
                    mtime = new ArrayList<>();
                    keys = new ArrayList<>();
                }
                messages.add(etxt_sendmessage_chat.getText().toString());
                keys.add(1);
                mName.add(username);
                mtime.add(currentDateTime.split(" ")[1]);
                                recyclerView_adapter.notifyDataSetChanged();
                recyclerView_layoutManager.scrollToPosition(recyclerView_adapter.getItemCount() -1);
                recyclerView_chatActivity.setLayoutManager(recyclerView_layoutManager);

               try {
                   pref.put("chatdataid"+senderId,0+"");

               }catch (Exception e){
                   e.printStackTrace();
               }
                sendMessagerequest();
               // new sendMessage().execute();
            }
        });
        sendstatusrequest();
        //new sendStatus().execute();
    }

//    @Override
//    public void notificationReceived(OSNotification notificationRecieved) {
//        final String id_sender,username,id_job = null;
//        String ifMessage = "You have New Message";
//        String ifJob = "You have offered new Job please view details";
//        try {
//            Log.e("notifi",""+notificationRecieved.toJSONObject());
//            JSONObject data = notificationRecieved.toJSONObject();
//            Log.e("notifi",""+data);
//            JSONObject payload = data.getJSONObject("payload");
//            Log.e("notifi",""+payload);
//
//
//            String body = payload.getString("body");
//            Log.e("msgbody",""+body);
//            if (body.equalsIgnoreCase(ifMessage)){
//                Log.e("bodaa",""+body);
//                JSONObject additionalData = payload.getJSONObject("additionalData");
//                Log.e("bodaa",""+additionalData);
//                id_sender = additionalData.getString("SenderId");
//                Log.e("bodaa",""+id_sender);
//                username = additionalData.getString("username");
//                Log.e("bodaa",""+username);
//
//                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        Loadchatrequest();
//                      //  new loadChat().execute();
//                    }
//                },500);
//            }
//            else if (body.equalsIgnoreCase(ifJob)){
//                Log.e("bodaa","Yayyy");
//                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        /*AlertDialog.Builder alert = new AlertDialog.Builder(ChatActivity.this);
//                        alert.setTitle("CabsWiki").setMessage("Amad"+"\nDo you want to view?").setPositiveButton("Yes", new DialogInterface.OnClickListener() {
//                            @Override
//                            public void onClick(DialogInterface dialogInterface, int i) {
//                                startActivity(new Intent(ChatActivity.this,JobView.class).putExtra("fromNotification",1));
//                            }
//                        }).show();*/
//                        Snackbar snackbar = Snackbar
//                                .make(etxt_sendmessage_chat, "You have a new Job", Snackbar.LENGTH_LONG).setAction("Show Me", new View.OnClickListener() {
//                                    @Override
//                                    public void onClick(View view) {
//                                        startActivity(new Intent(ChatActivity.this,JobView.class).putExtra("fromNotification",1));
//                                    }
//                                });
//                        snackbar.setActionTextColor(Color.RED);
//                        snackbar.show();
//                    }
//                },500);
//            }
//        }
//        catch (Exception ex){
//
//        }
//    }

    @Override
    public void onBackPressed() {
        super.onBackPressed();
        try {
            postRequest.cancel();
        }catch (Exception e){
            e.printStackTrace();
        }
    }


    void Loadchatrequest() {
        pd = (LinearLayout)findViewById(R.id.loadingbar);
        pd.setVisibility(View.VISIBLE);
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                  new Response.Listener<String>() {
                      @Override
                      public void onResponse(String response) {

                          // pd.dismiss();
                          if(response.toString().equalsIgnoreCase("error")){
                              Log.d("datachat32",response.toString());

                              Loadchatrequest();
                          }else {
                              Log.d("datachat32",response.toString());
                              SecurePreferences editor =  pref;
                              editor.put("chatdata"+senderId,response);
                              editor.put("chatdataid"+senderId,1+"");
                              Log.e("user",senderId);
//                              editor.commit();
                              loadchatdata(response);
                          }

                      }
                  },
                  new Response.ErrorListener() {
                      @Override
                      public void onErrorResponse(VolleyError error) {
                          error.printStackTrace();
                          pd.setVisibility(View.GONE);
                          Toast.makeText(ChatActivity.this, "network error", Toast.LENGTH_SHORT).show();
                      }
                  }
          ) {
              // here is params will add to your url using post method
              @Override
              protected Map<String, String> getParams() {
                  Map<String, String> params = new HashMap<>();
//                  params.put("SenderId", senderId );
//                  params.put("DriverId",pref.getInt("user_id",0)+"");
//

                  params.put("Parms", "SenderId,,"+senderId+"&&DriverId,,"+pref.getString("user_id"));
                  params.put("Action", "DriverConversation");
                  params.put("UserKey", appcontext.getInstance().passforlink);
                  params.put("Token", appcontext.getInstance().token);
                  // "DriverId="+pref.getInt("user_id",0);
                  //params.put("2ndParamName","valueoF2ndParam");
                  return params;
              }
          };

        //postRequest.setRetryPolicy(new DefaultRetryPolicy(DefaultRetryPolicy.DEFAULT_TIMEOUT_MS * 2, 2, DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
       // postRequest.setShouldCache(true);
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(ChatActivity.this).add(postRequest);
    }

    void loadchatdata(String s) {
        pd.setVisibility(View.GONE);
        try {
            keys = new ArrayList<>();
            messages = new ArrayList<>();
            mName = new ArrayList<>();
            mtime = new ArrayList<>();
//            JSONObject obj = new JSONObject(s);
            JSONArray DriverInfo = new JSONArray(s);
            Log.e("datachat32",""+DriverInfo.getJSONObject(0).getString("SenderID"));

            for (int i = 0; i < DriverInfo.length();i++){
                JSONObject obj_inner = DriverInfo.getJSONObject(i);
                Log.d("drivers",obj_inner.toString());
                int driver_recieved = obj_inner.getInt("SenderID");
                Log.e("driversnder",""+driver_recieved);
                String message = obj_inner.getString("Message");
                String time = obj_inner.getString("Time");
                String drivername = obj_inner.getString("User Name");
                HashMap<String,String> msgz = new HashMap<>();
                if (driver_recieved == Integer.parseInt(pref.getString("user_id"))){
                    keys.add(1);
                    messages.add(message);
                    mtime.add(time);
                    mName.add(drivername);


                }
                else {

                    keys.add(0);
                    messages.add(message);
                    mtime.add(time);
                    mName.add(username);
                }
            }

            recyclerView_adapter = new ChatAdapter(messages,mtime,mName,keys);
            recyclerView_chatActivity.setAdapter(recyclerView_adapter);
            recyclerView_layoutManager.scrollToPosition(recyclerView_adapter.getItemCount() -1);
            recyclerView_chatActivity.setLayoutManager(recyclerView_layoutManager);

                /*LinearLayoutManager layoutManager = new LinearLayoutManager(ChatActivity.this);
                layoutManager.setReverseLayout(true);
                layoutManager.setStackFromEnd(true);
                layoutManager.scrollToPosition(0);
                recyclerView_chatActivity.setLayoutManager(layoutManager);*/
        }
        catch (Exception ex){
            keys = new ArrayList<>();
            messages = new ArrayList<>();
            mName = new ArrayList<>();
            mtime = new ArrayList<>();
            recyclerView_adapter = new ChatAdapter(messages,mtime,mName,keys);
            recyclerView_chatActivity.setAdapter(recyclerView_adapter);
            recyclerView_layoutManager.scrollToPosition(recyclerView_adapter.getItemCount() -1);
            recyclerView_chatActivity.setLayoutManager(recyclerView_layoutManager);
            Toast.makeText(this, "No Chat Available", Toast.LENGTH_SHORT).show();
           // onBackPressed();
            Log.e("error found",ex.getMessage());
        }
    }

    //unused
    public class loadChat extends AsyncTask<Void,Void,String> {
        String data = "";
        @Override
        protected void onPreExecute() {
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "SenderId="+senderId+"&DriverId="+appcontext.getInstance().DriverId;
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
            }
            catch (Exception ex){

            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            try {
                JSONObject obj = new JSONObject(s);
                JSONArray DriverInfo = obj.getJSONArray("DriverInfo");
                keys = new ArrayList<>();
                messages = new ArrayList<>();
                mName = new ArrayList<>();
                mtime = new ArrayList<>();
                for (int i = 0; i < DriverInfo.length();i++){
                    JSONObject obj_inner = DriverInfo.getJSONObject(i);
                    Log.d("drivers",obj_inner.toString());
                    int driver_recieved = obj_inner.getInt("SenderID");
                    Log.e("error in  loop",""+driver_recieved);
                    String message = obj_inner.getString("Message");
                    String time = obj_inner.getString("DateTime").split("T")[1];
                    String drivername = obj_inner.getString("User Name");
                    if (driver_recieved == Integer.parseInt(pref.getString("user_id"))){
                        keys.add(1);
                        messages.add(message);
                        mtime.add(time);
                        mName.add(drivername);
                    }
                    else {
                        keys.add(0);
                        messages.add(message);
                        mtime.add(time);
                        mName.add(username);
                    }
                }

                recyclerView_adapter = new ChatAdapter(messages,mtime,mName,keys);
                recyclerView_chatActivity.setAdapter(recyclerView_adapter);
                recyclerView_layoutManager.scrollToPosition(recyclerView_adapter.getItemCount() -1);
                recyclerView_chatActivity.setLayoutManager(recyclerView_layoutManager);

                /*LinearLayoutManager layoutManager = new LinearLayoutManager(ChatActivity.this);
                layoutManager.setReverseLayout(true);
                layoutManager.setStackFromEnd(true);
                layoutManager.scrollToPosition(0);
                recyclerView_chatActivity.setLayoutManager(layoutManager);*/
            }
            catch (Exception ex){
                Log.e("error found",ex.getMessage());
            }
        }
    }


    void sendMessagerequest() {

       postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                        sendmessagedata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(getApplicationContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                old method
//                params.put("RecieveId", senderId);
//                params.put("DriverId",driverId+"");
//                params.put("Message",message_tobe_sent+"");
//                params.put("DateTime", date_tobe_sent.replace("p.m.","pm").replace("a.m.","am"));
//

                params.put("Parms", "RecieveId,,"+senderId+"&&DriverId,,"+driverId+"&&Message,,"+message_tobe_sent+"&&DateTime,,"+date_tobe_sent.replace("p.m.","pm").replace("a.m.","am"));
                params.put("Action", "DriverSendMessage");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
       postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
               DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
               DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
    }

    void sendmessagedata(String s) {
        Toast.makeText(ChatActivity.this, s, Toast.LENGTH_SHORT).show();
        etxt_sendmessage_chat.setText("");
        try {
            Log.e("player_id",player_id);
            String dataToBeSent = getApplicationContext().getString(R.string.ChatRoom)+driverId;
            JSONObject obj = new JSONObject();
            JSONObject contents = new JSONObject();
            JSONArray include_player_ids = new JSONArray();
            JSONObject data = new JSONObject();
            contents.put("en","You have a new message");
            data.put("driverId",driverId);
            include_player_ids.put(0,player_id);
            obj.put("contents",contents);
            obj.put("data",data);
            obj.put("include_player_ids",include_player_ids);
            Log.e("maddy",obj.toString());

            //Log.e("player_id",date_tobe_sent);
//            OneSignal.postNotification(obj, new OneSignal.PostNotificationResponseHandler() {
//                @Override
//                public void onSuccess(JSONObject response) {
//                    Log.e("msgsucess",response.toString());
//                }
//
//                @Override
//                public void onFailure(JSONObject response) {
//                    Log.e("msgNotfail",response.toString());
//                }
//            });

        } catch (JSONException e) {
            Log.e("player_id",e.getMessage());
        }
        Log.e("resp",s);
    }
//unsed
    public class sendMessage extends AsyncTask<Void,Void,String> {
        String data = "";
        @Override
        protected void onPreExecute() {
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "RecieveId="+senderId+"&DriverId="+driverId+"&Message="+message_tobe_sent+"&DateTime="+date_tobe_sent.replace("p.m.","pm").replace("a.m.","am");
                Log.e("params",params);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
            }
            catch (Exception ex){

            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            Toast.makeText(ChatActivity.this, s, Toast.LENGTH_SHORT).show();
            etxt_sendmessage_chat.setText("");
            try {
                Log.e("player_id",player_id);
                String dataToBeSent = getApplicationContext().getString(R.string.ChatRoom)+driverId;
                JSONObject obj = new JSONObject();
                JSONObject contents = new JSONObject();
                JSONArray include_player_ids = new JSONArray();
                JSONObject data = new JSONObject();
                contents.put("en","You have a new message");
                data.put("driverId",driverId);
                include_player_ids.put(0,player_id);
                obj.put("contents",contents);
                obj.put("data",data);
                obj.put("include_player_ids",include_player_ids);
                Log.e("maddy",obj.toString());

                Log.e("player_id",date_tobe_sent);
//                OneSignal.postNotification(obj, null);
            } catch (JSONException e) {
                Log.e("player_id",e.getMessage());
            }
            Log.e("resp",s);
        }
    }

    void sendstatusrequest() {


      postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                       // setdata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(getApplicationContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                //old method
//                params.put("DriverId", pref.getInt("user_id",0)+"" );
//                params.put("CompanyId",pref.getString("company_id","null"));


                params.put("Parms", "DriverId,,"+appcontext.getInstance().DriverId+"&&CompanyId,,"+pref.getString("company_id"));
                params.put("Action", "MessageStatusUpdate");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
      postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
              DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
              DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
    }

//unused
    public class sendStatus extends AsyncTask<Void,Void,String> {
        String data = "";
        @Override
        protected void onPreExecute() {
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "SenderId="+senderId+"&DriverId="+driverId;
                Log.e("params",params);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
            }
            catch (Exception ex){

            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
        }
    }
}
