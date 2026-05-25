package com.khybertech.taxi360driver.JobView.Fragments;


import android.content.Context;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.preference.PreferenceManager;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.Chat.InboxAdapter;
import com.khybertech.taxi360driver.Chat.ModelInbox;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A simple {@link Fragment} subclass.
 */
public class Chat extends Fragment {

    RecyclerView rv_chatinbox;
    RecyclerView.LayoutManager rv_layoutManager;
    RecyclerView.Adapter rv_adapter;
    Context c;
    SecurePreferences pref;

    String[] name = new String[]{"Amad","Ali","Ahmad","Sanan","Nangial","Majid","Nahyan","Yasir","Majid Mohmand","Haseeb","Saqib","Sara","Hina","Umama","Sumaira"};

    public Chat() {
        // Required empty public constructor
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        c = appcontext.getInstance().con; //getActivity().getApplicationContext();
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_chat, container, false);
        rv_chatinbox = (RecyclerView) v.findViewById(R.id.rv_chatinbox);
//        pref = PreferenceManager.getDefaultSharedPreferences(getActivity());
         pref = appcontext.getInstance().pref;
        rv_layoutManager = new LinearLayoutManager(getContext());
        rv_chatinbox.setLayoutManager(rv_layoutManager);

     //   new loadInbox().execute();
        return v;
    }
    StringRequest postRequest;

    @Override
    public void setUserVisibleHint(boolean isVisibleToUser) {
        super.setUserVisibleHint(isVisibleToUser);

            if(isVisibleToUser){
                Log.d("MyTag","My Fragment is visible");
                c = appcontext.getInstance().con;
                //getActivity().getApplicationContext();
//                pref = PreferenceManager.getDefaultSharedPreferences(c);

                Log.d("MyTag", "My Fragment is visible current");

                if (pref.getString("chatstatus").equalsIgnoreCase("1")) {
                    setdata(pref.getString("chatdata"));
                    //   break;
                }else {
                    new Handler().postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            setdata(pref.getString("chatdata"));
                        }
                    }, 2000);
                }
            }

    }

    void MakePostRequest() {

        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                        setdata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(c, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                params.put("DriverId", appcontext.getInstance().DriverId+"" );
                params.put("CompanyId",pref.getString("company_id"));

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(c).add(postRequest);
    }

    void setdata(String s) {

        try {
            List<ModelInbox>  ls = new ArrayList<>();
            Log.e("json",s);
//            JSONObject obj = new JSONObject(s);
            JSONArray DriverInfo = new JSONArray(s);
            for (int i = 0; i < DriverInfo.length();i++){
                JSONObject obj_inner = DriverInfo.getJSONObject(i);
                ModelInbox m = new ModelInbox();
                m.setName(obj_inner.getString("User Name"));
                m.setUnread("Unread Messages: "+String.valueOf(obj_inner.getInt("UnRead Messages")));
                m.setId(String.valueOf(obj_inner.getInt("Id")));
                m.setPlayerid(obj_inner.getString("PlayerId"));
                ls.add(m);
            }
            rv_adapter = new InboxAdapter(ls,getActivity());
            rv_chatinbox.setAdapter(rv_adapter);
        }
        catch (Exception ex){
            Log.e("error",ex.getMessage());
        }
    }






    @Override
    public void onResume() {
        super.onResume();
        Log.e("fragmentDatachat","OnResume");
    }

    @Override
    public void onPause() {
        super.onPause();
        //postRequest.cancel();
        Log.e("fragmentDatachat","OnPause");
    }

    @Override
    public void onStop() {
        super.onStop();

        Log.e("fragmentDatachat","OnStop");
    }



    @Override
    public void onStart() {
        super.onStart();
     //  MakePostRequest();
       // new loadInbox().execute();
        Log.e("fragmentDatachat","OnStart");
    }


    public class loadInbox extends AsyncTask<Void,Void,String>{
        String data = "";
        List<ModelInbox> ls;
        @Override
        protected void onPreExecute() {
            ls = new ArrayList<>();
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "DriverId="+appcontext.getInstance().DriverId+"&CompanyId="+pref.getString("company_id");
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
                Log.e("json",s);
                JSONObject obj = new JSONObject(s);
                JSONArray DriverInfo = obj.getJSONArray("DriverInfo");
                for (int i = 0; i < DriverInfo.length();i++){
                    JSONObject obj_inner = DriverInfo.getJSONObject(i);
                    ModelInbox m = new ModelInbox();
                    m.setName(obj_inner.getString("User Name"));
                    m.setUnread("Unread Messages: "+String.valueOf(obj_inner.getInt("UnRead Messages")));
                    m.setId(String.valueOf(obj_inner.getInt("Id")));
                    m.setPlayerid(obj_inner.getString("PlayerId"));
                    ls.add(m);
                }
                rv_adapter = new InboxAdapter(ls,getActivity());
                rv_chatinbox.setAdapter(rv_adapter);
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }
        }
    }

}
