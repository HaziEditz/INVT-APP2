package com.khybertech.taxi360driver.MainActivity;


import android.app.ProgressDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;

import com.khybertech.taxi360driver.JobView.CompletedJobDetail;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
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

public class ZonesDetails extends AppCompatActivity {

    String url_completed = ""; //"http://webservices.360taxi.co.nz/api/DriverApp/FnDriverClosedJobs";
    Context c;
    SharedPreferences pref;
    SimpleAdapter adapter_list_completed;
    ListView lv_fragment_completed;
    List<HashMap<String,Object>> ls;
    Toolbar toolbar_MyAccount;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activityzones);


        toolbar_MyAccount = (Toolbar) findViewById(R.id.toolbar_historyactivity);
        toolbarMethod();
        lv_fragment_completed = (ListView) findViewById(R.id.lv_fragment_completed);
        ls = new ArrayList<>();
        pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        MakePostRequest();

    }

    public void toolbarMethod(){
        setSupportActionBar(toolbar_MyAccount);
        getSupportActionBar().setTitle("Shifts HIstory");
        toolbar_MyAccount.setNavigationIcon(R.mipmap.nav_back1);
        toolbar_MyAccount.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onBackPressed();
            }
        });
    }

    ProgressDialog pd;
    StringRequest postRequest;

    void MakePostRequest() {
        Log.e("datahistory","called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("ridehistory",response.toString());

                        // pd.dismiss();
                        setdata(response.toString());


                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(ZonesDetails.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("DriverId", pref.getInt("user_id",0)+"" );

                params.put("Parms", "CompanyId,,"+pref.getString("company_id","")+"");
                params.put("Action", "AllZonesDetails");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(ShiftsHistory.this).add(postRequest);
    }


    void setdata(String s){
        //  pd.dismiss();


        try {

//            JSONObject obj = new JSONObject(s);
            //[{"ZoneId":18,"ZoneName":"Hayatabad Area","ZoneCount":5},{"ZoneId":127,"ZoneName":"Town","ZoneCount":2}]
            JSONArray arr = new JSONArray(s);
//            arr.put(obj);
            Log.e("zonesdetails",arr.toString());
            ls.clear();
            for (int i = 0; i < arr.length(); i++){
                int booking_id = arr.getJSONObject(i).getInt("ZoneId");
                String passenger_name = arr.getJSONObject(i).getString("ZoneName");
                String passenger_contact = arr.getJSONObject(i).getString("ZoneCount");
                String JobsCount = arr.getJSONObject(i).getString("JobsCount");

                HashMap<String,Object> hm = new HashMap<>();
                hm.put("booking_id",booking_id);
                hm.put("passenger_name",passenger_name);
                hm.put("passenger_contact",passenger_contact);
                ls.add(hm);
            }

            String[] from = {"Zone_id: ","Zone Name: ","Total cars: "};
            int[] to = {R.id.txt_list_current_bookingid,R.id.txt_list_current_passengername,R.id.txt_list_current_passengercontact};
            adapter_list_completed = new SimpleAdapter(this,ls,R.layout.row_list_fragments,from,to);
            adapter_list_completed.notifyDataSetChanged();
            lv_fragment_completed.setAdapter(adapter_list_completed);
            lv_fragment_completed.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                @Override
                public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
//                    String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
//                    startActivity(new Intent(ZonesDetails.this, CompletedJobDetail.class).putExtra("booking_id",booking_id));
                }
            });
            Log.e("fragmentDatacomp",s);
        }
        catch (Exception ex){
            Log.e("rideshistoryexecption",ex.getMessage());
            ex.printStackTrace();
        }



    }



    @Override
    public void onResume() {
        super.onResume();
        Log.e("fragmentDatacomp","OnResume");
    }

    @Override
    public void onPause() {
        super.onPause();
        //postRequest.cancel();
        Log.e("fragmentDatacomp","OnPause");
    }

    @Override
    public void onStop() {
        super.onStop();

        Log.e("fragmentDatacomp","OnStop");
    }

    @Override
    public void onStart() {
        super.onStart();

        // new getcompletedJobs().execute();
        Log.e("fragmentDatacomp","OnStart");
    }

    public class getcompletedJobs extends AsyncTask<Void,Void,String> {
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            //  pd = ProgressDialog.show(getActivity(),"360 Taxi","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try{
                URL url = new URL(url_completed);
                HttpURLConnection conn = (HttpURLConnection)url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "DriverId="+pref.getInt("user_id",0);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("fragmentData",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            //  pd.dismiss();
            try {
                ls.clear();
                JSONObject obj = new JSONObject(s);
                JSONArray arr = obj.getJSONArray("DriverJobsInfo");
                for (int i = 0; i < arr.length(); i++){
                    int booking_id = arr.getJSONObject(i).getInt("BookingId");
                    String passenger_name = arr.getJSONObject(i).getString("Name");
                    String passenger_contact = arr.getJSONObject(i).getString("PassengerId");
                    HashMap<String,Object> hm = new HashMap<>();
                    hm.put("booking_id",booking_id);
                    hm.put("passenger_name",passenger_name);
                    hm.put("passenger_contact",passenger_contact);
                    ls.add(hm);
                }
                String[] from = {"booking_id","passenger_name","passenger_contact"};
                int[] to = {R.id.txt_list_current_bookingid,R.id.txt_list_current_passengername,R.id.txt_list_current_passengercontact};
                adapter_list_completed = new SimpleAdapter(ZonesDetails.this,ls,R.layout.row_list_fragments,from,to);
                adapter_list_completed.notifyDataSetChanged();
                lv_fragment_completed.setAdapter(adapter_list_completed);
                lv_fragment_completed.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                    @Override
                    public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                        String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                        startActivity(new Intent(ZonesDetails.this, CompletedJobDetail.class).putExtra("booking_id",booking_id));
                    }
                });
            }
            catch (Exception ex){

            }
            Log.e("fragmentData",s);
        }
    }
}
