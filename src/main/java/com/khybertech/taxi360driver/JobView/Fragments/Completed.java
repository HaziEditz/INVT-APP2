package com.khybertech.taxi360driver.JobView.Fragments;


import android.app.ProgressDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.preference.PreferenceManager;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.CompletedJobDetail;
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
public class Completed extends Fragment {

    String url_completed = ""; //"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverClosedJobs";
    Context c;
    SecurePreferences pref;
    SimpleAdapter adapter_list_completed;
    ListView lv_fragment_completed;
    List<HashMap<String,Object>> ls;

    public Completed() {
        // Required empty public constructor
    }


    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_completed, container, false);
        lv_fragment_completed = (ListView) v.findViewById(R.id.lv_fragment_completed);
        ls = new ArrayList<>();
        return v;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        c = appcontext.getInstance().con;//getActivity().getApplicationContext();
//        pref = PreferenceManager.getDefaultSharedPreferences(c);
        pref = appcontext.getInstance().pref;
        url_completed = appcontext.getInstance().link;
    }
    ProgressDialog pd;
    StringRequest postRequest;

    @Override
    public void setUserVisibleHint(boolean isVisibleToUser) {
        super.setUserVisibleHint(isVisibleToUser);
      //  c = appcontext.getInstance().con;
            if(isVisibleToUser){
                Log.d("MyTag","My Fragment is visible");
               c = appcontext.getInstance().con;
                //getActivity().getApplicationContext();
//                pref = PreferenceManager.getDefaultSharedPreferences(c);

                Log.d("MyTag", "My Fragment is visible current");
                if (pref.getString("completedstatus").equalsIgnoreCase("1")) {
                    setdata(pref.getString("completeddata"));
                    //   break;
                }else {
                    new Handler().postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            setdata(pref.getString("completeddata"));
                        }
                    }, 2000);
                }


            }else {
                Log.d("MyTag","My Fragment is not visible");
            }

    }
    void MakePostRequest() {

        postRequest = new StringRequest(Request.Method.POST, url_completed,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                       // pd.dismiss();
                        setdata(response.toString());

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


    void setdata(String s){
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
                adapter_list_completed = new SimpleAdapter(getActivity(),ls,R.layout.row_list_fragments,from,to);
                adapter_list_completed.notifyDataSetChanged();
                lv_fragment_completed.setAdapter(adapter_list_completed);
                lv_fragment_completed.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                    @Override
                    public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                        String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                        startActivity(new Intent(getActivity(), CompletedJobDetail.class).putExtra("booking_id",booking_id));
                    }
                });
                Log.e("fragmentDatacomp",s);
            }
            catch (Exception ex){
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
      // MakePostRequest();
       // new getcompletedJobs().execute();
        Log.e("fragmentDatacomp","OnStart");
    }

    public class getcompletedJobs extends AsyncTask<Void,Void,String> {
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
          //  pd = ProgressDialog.show(getActivity(),"360taxi Taxi","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try{
                URL url = new URL(url_completed);
                HttpURLConnection conn = (HttpURLConnection)url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                String params = "DriverId="+appcontext.getInstance().DriverId;
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
                adapter_list_completed = new SimpleAdapter(getActivity(),ls,R.layout.row_list_fragments,from,to);
                adapter_list_completed.notifyDataSetChanged();
                lv_fragment_completed.setAdapter(adapter_list_completed);
                lv_fragment_completed.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                    @Override
                    public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                        String booking_id = ((TextView)view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                        startActivity(new Intent(getActivity(), CompletedJobDetail.class).putExtra("booking_id",booking_id));
                    }
                });
            }
            catch (Exception ex){

            }
            Log.e("fragmentData",s);
        }
    }
}
